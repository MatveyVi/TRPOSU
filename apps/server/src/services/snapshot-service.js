const fs = require("fs/promises");
const path = require("path");
const { config } = require("../config");
const { pool, withTransaction } = require("../db");

const DEFAULT_POINTS = [
  { code: "A", name: "Пункт A", capacity: 8 },
  { code: "B", name: "Пункт Б", capacity: 8 }
];

const DEFAULT_TYPES = [
  { code: "A", label: "Тип А" },
  { code: "B", label: "Тип Б" },
  { code: "C", label: "Тип В" }
];

async function ensureReferenceData(client) {
  for (const point of DEFAULT_POINTS) {
    await client.query(
      `
        INSERT INTO rental_points (code, name, capacity)
        VALUES ($1, $2, $3)
        ON CONFLICT (code) DO UPDATE
        SET name = EXCLUDED.name,
            capacity = EXCLUDED.capacity
      `,
      [point.code, point.name, point.capacity]
    );
  }

  for (const transportType of DEFAULT_TYPES) {
    await client.query(
      `
        INSERT INTO transport_types (code, label)
        VALUES ($1, $2)
        ON CONFLICT (code) DO UPDATE
        SET label = EXCLUDED.label
      `,
      [transportType.code, transportType.label]
    );
  }
}

async function ensureSnapshotDirectory() {
  await fs.mkdir(path.dirname(config.snapshotPath), { recursive: true });
}

async function readSnapshot() {
  try {
    const raw = await fs.readFile(config.snapshotPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    console.log("Snapshot file exists but cannot be read, falling back to defaults.");
    return null;
  }
}

async function getPointIdMap(client) {
  const result = await client.query("SELECT id, code FROM rental_points");
  const map = new Map();

  for (const row of result.rows) {
    map.set(row.code, row.id);
  }

  return map;
}

async function getTypeIdMap(client) {
  const result = await client.query("SELECT id, code FROM transport_types");
  const map = new Map();

  for (const row of result.rows) {
    map.set(row.code, row.id);
  }

  return map;
}

async function seedDefaultInventory(client) {
  const pointIdMap = await getPointIdMap(client);
  const typeIdMap = await getTypeIdMap(client);

  for (const point of DEFAULT_POINTS) {
    for (const transportType of DEFAULT_TYPES) {
      await client.query(
        `
          INSERT INTO inventory (point_id, transport_type_id, available_count)
          VALUES ($1, $2, 2)
          ON CONFLICT (point_id, transport_type_id) DO UPDATE
          SET available_count = EXCLUDED.available_count
        `,
        [pointIdMap.get(point.code), typeIdMap.get(transportType.code)]
      );
    }
  }
}

function normalizeSnapshot(snapshot) {
  if (
    !snapshot ||
    !Array.isArray(snapshot.points) ||
    !Array.isArray(snapshot.activeRentals)
  ) {
    return null;
  }

  return snapshot;
}

async function restoreFromSnapshot(client, snapshot) {
  const normalizedSnapshot = normalizeSnapshot(snapshot);

  if (!normalizedSnapshot) {
    await seedDefaultInventory(client);
    return;
  }

  const pointIdMap = await getPointIdMap(client);
  const typeIdMap = await getTypeIdMap(client);

  await client.query("DELETE FROM inventory");
  await client.query("DELETE FROM rentals");
  await client.query("DELETE FROM operation_logs");

  for (const point of normalizedSnapshot.points) {
    const pointId = pointIdMap.get(point.code);
    const inventory = point.inventory || {};

    if (!pointId) {
      continue;
    }

    for (const transportType of DEFAULT_TYPES) {
      await client.query(
        `
          INSERT INTO inventory (point_id, transport_type_id, available_count)
          VALUES ($1, $2, $3)
        `,
        [
          pointId,
          typeIdMap.get(transportType.code),
          Number(inventory[transportType.code] || 0)
        ]
      );
    }
  }

  let maxRentalNumber = 0;

  for (const rental of normalizedSnapshot.activeRentals) {
    const numericPart = Number(String(rental.id || "").replace(/[^\d]/g, ""));

    if (numericPart > maxRentalNumber) {
      maxRentalNumber = numericPart;
    }

    await client.query(
      `
        INSERT INTO rentals (id, transport_type_id, source_point_id, status, rented_at)
        VALUES ($1, $2, $3, 'active', COALESCE($4, NOW()))
      `,
      [
        rental.id,
        typeIdMap.get(rental.transportTypeCode),
        pointIdMap.get(rental.sourcePointCode),
        rental.rentedAt || new Date().toISOString()
      ]
    );
  }

  for (const entry of normalizedSnapshot.operationLog || []) {
    await client.query(
      `
        INSERT INTO operation_logs (
          type,
          message,
          point_code,
          transport_type_code,
          quantity,
          rental_ids,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7, NOW()))
      `,
      [
        entry.type || "info",
        entry.message || "Восстановленная операция",
        entry.pointCode || null,
        entry.transportTypeCode || null,
        entry.quantity === undefined || entry.quantity === null
          ? null
          : Number(entry.quantity),
        JSON.stringify(Array.isArray(entry.rentalIds) ? entry.rentalIds : []),
        entry.createdAt || null
      ]
    );
  }

  await client.query("SELECT setval('rental_id_seq', $1, true)", [Math.max(maxRentalNumber, 1)]);
}

async function buildSnapshot() {
  const pointsResult = await pool.query(
    `
      SELECT
        p.code AS point_code,
        p.name AS point_name,
        p.capacity,
        t.code AS type_code,
        i.available_count
      FROM rental_points p
      JOIN inventory i ON i.point_id = p.id
      JOIN transport_types t ON t.id = i.transport_type_id
      ORDER BY p.code, t.code
    `
  );

  const rentalsResult = await pool.query(
    `
      SELECT
        r.id,
        r.rented_at,
        tp.code AS transport_type_code,
        sp.code AS source_point_code
      FROM rentals r
      JOIN transport_types tp ON tp.id = r.transport_type_id
      JOIN rental_points sp ON sp.id = r.source_point_id
      WHERE r.status = 'active'
      ORDER BY r.id
    `
  );

  const operationLogsResult = await pool.query(
    `
      SELECT
        id,
        type,
        message,
        point_code,
        transport_type_code,
        quantity,
        rental_ids,
        created_at
      FROM operation_logs
      ORDER BY created_at DESC, id DESC
      LIMIT 50
    `
  );

  const points = [];
  const pointMap = new Map();

  for (const row of pointsResult.rows) {
    if (!pointMap.has(row.point_code)) {
      const pointData = {
        code: row.point_code,
        name: row.point_name,
        capacity: row.capacity,
        inventory: {}
      };

      pointMap.set(row.point_code, pointData);
      points.push(pointData);
    }

    pointMap.get(row.point_code).inventory[row.type_code] = Number(row.available_count);
  }

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    points,
    activeRentals: rentalsResult.rows.map((row) => ({
      id: row.id,
      rentedAt: row.rented_at,
      transportTypeCode: row.transport_type_code,
      sourcePointCode: row.source_point_code
    })),
    operationLog: operationLogsResult.rows.map((row) => ({
      type: row.type,
      message: row.message,
      pointCode: row.point_code,
      transportTypeCode: row.transport_type_code,
      quantity: row.quantity === null ? null : Number(row.quantity),
      rentalIds: Array.isArray(row.rental_ids) ? row.rental_ids : [],
      createdAt: row.created_at
    }))
  };
}

async function saveSnapshot() {
  await ensureSnapshotDirectory();
  const snapshot = await buildSnapshot();
  await fs.writeFile(config.snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
}

async function bootstrapState() {
  const snapshot = await readSnapshot();

  await withTransaction(async (client) => {
    await ensureReferenceData(client);

    const inventoryCountResult = await client.query("SELECT COUNT(*)::int AS count FROM inventory");
    const rentalsCountResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM rentals WHERE status = 'active'"
    );
    const operationLogsCountResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM operation_logs"
    );

    const inventoryCount = inventoryCountResult.rows[0].count;
    const activeRentalsCount = rentalsCountResult.rows[0].count;
    const operationLogsCount = operationLogsCountResult.rows[0].count;

    if (inventoryCount === 0 && activeRentalsCount === 0) {
      if (snapshot) {
        await restoreFromSnapshot(client, snapshot);
      } else {
        await seedDefaultInventory(client);
      }
    }

    if (
      !(inventoryCount === 0 && activeRentalsCount === 0) &&
      operationLogsCount === 0 &&
      snapshot &&
      Array.isArray(snapshot.operationLog) &&
      snapshot.operationLog.length > 0
    ) {
      for (const entry of snapshot.operationLog) {
        await client.query(
          `
            INSERT INTO operation_logs (
              type,
              message,
              point_code,
              transport_type_code,
              quantity,
              rental_ids,
              created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7, NOW()))
          `,
          [
            entry.type || "info",
            entry.message || "Восстановленная операция",
            entry.pointCode || null,
            entry.transportTypeCode || null,
            entry.quantity === undefined || entry.quantity === null
              ? null
              : Number(entry.quantity),
            JSON.stringify(Array.isArray(entry.rentalIds) ? entry.rentalIds : []),
            entry.createdAt || null
          ]
        );
      }
    }
  });

  await saveSnapshot();
}

module.exports = {
  DEFAULT_POINTS,
  DEFAULT_TYPES,
  bootstrapState,
  saveSnapshot
};
