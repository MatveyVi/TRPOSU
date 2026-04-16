const { pool, withTransaction } = require("../db");
const { saveSnapshot } = require("./snapshot-service");
const { AppError } = require("../utils/app-error");

const OPERATION_LIMIT = 30;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function parseQuantity(value) {
  const quantity = Number(value);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new AppError("Количество должно быть целым числом больше нуля.");
  }

  return quantity;
}

async function getPointByCode(client, pointCode) {
  const result = await client.query(
    "SELECT id, code, name, capacity FROM rental_points WHERE code = $1",
    [normalizeCode(pointCode)]
  );

  if (result.rowCount === 0) {
    throw new AppError("Выбранный пункт проката не найден.");
  }

  return result.rows[0];
}

async function getTypeByCode(client, transportTypeCode) {
  const result = await client.query(
    "SELECT id, code, label FROM transport_types WHERE code = $1",
    [normalizeCode(transportTypeCode)]
  );

  if (result.rowCount === 0) {
    throw new AppError("Выбранный тип транспорта не найден.");
  }

  return result.rows[0];
}

async function getPointTotal(client, pointId) {
  const result = await client.query(
    "SELECT COALESCE(SUM(available_count), 0)::int AS total FROM inventory WHERE point_id = $1",
    [pointId]
  );

  return result.rows[0].total;
}

async function getAvailableCount(client, pointId, typeId) {
  const result = await client.query(
    `
      SELECT available_count
      FROM inventory
      WHERE point_id = $1 AND transport_type_id = $2
    `,
    [pointId, typeId]
  );

  if (result.rowCount === 0) {
    throw new AppError("Для выбранного транспорта не найден остаток.");
  }

  return Number(result.rows[0].available_count);
}

function buildPointText(point) {
  const lines = [
    `${point.name}`,
    `Тип А: ${point.inventory.find((item) => item.code === "A")?.availableCount || 0} шт.`,
    `Тип Б: ${point.inventory.find((item) => item.code === "B")?.availableCount || 0} шт.`,
    `Тип В: ${point.inventory.find((item) => item.code === "C")?.availableCount || 0} шт.`,
    `Всего на точке: ${point.currentCount} из ${point.capacity}`
  ];

  return lines.join("\n");
}

async function writeOperationLog(client, payload) {
  const {
    type,
    message,
    pointCode = null,
    transportTypeCode = null,
    quantity = null,
    rentalIds = [],
    createdAt = null
  } = payload;

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
      type,
      message,
      pointCode,
      transportTypeCode,
      quantity,
      JSON.stringify(rentalIds),
      createdAt
    ]
  );
}

async function getOperationLog(limit = OPERATION_LIMIT) {
  const result = await pool.query(
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
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    type: row.type,
    message: row.message,
    pointCode: row.point_code,
    transportTypeCode: row.transport_type_code,
    quantity: row.quantity === null ? null : Number(row.quantity),
    rentalIds: Array.isArray(row.rental_ids) ? row.rental_ids : [],
    createdAt: row.created_at
  }));
}

async function getState() {
  const pointsResult = await pool.query(
    `
      SELECT
        p.id AS point_id,
        p.code AS point_code,
        p.name AS point_name,
        p.capacity,
        t.code AS type_code,
        t.label AS type_label,
        i.available_count
      FROM rental_points p
      JOIN inventory i ON i.point_id = p.id
      JOIN transport_types t ON t.id = i.transport_type_id
      ORDER BY p.code, t.code
    `
  );

  const typesResult = await pool.query(
    "SELECT code, label FROM transport_types ORDER BY code"
  );

  const rentalsResult = await pool.query(
    `
      SELECT
        r.id,
        r.rented_at,
        t.code AS transport_type_code,
        t.label AS transport_type_label,
        p.code AS source_point_code,
        p.name AS source_point_name
      FROM rentals r
      JOIN transport_types t ON t.id = r.transport_type_id
      JOIN rental_points p ON p.id = r.source_point_id
      WHERE r.status = 'active'
      ORDER BY r.id
    `
  );

  const points = [];
  const pointMap = new Map();

  for (const row of pointsResult.rows) {
    if (!pointMap.has(row.point_code)) {
      const point = {
        code: row.point_code,
        name: row.point_name,
        capacity: Number(row.capacity),
        currentCount: 0,
        fillPercent: 0,
        inventory: []
      };

      pointMap.set(row.point_code, point);
      points.push(point);
    }

    const point = pointMap.get(row.point_code);
    const availableCount = Number(row.available_count);

    point.inventory.push({
      code: row.type_code,
      label: row.type_label,
      availableCount
    });

    point.currentCount += availableCount;
  }

  for (const point of points) {
    point.fillPercent = Math.round((point.currentCount / point.capacity) * 100);
    point.freeSlots = Math.max(point.capacity - point.currentCount, 0);
    point.textStatus = buildPointText(point);
  }

  const operationLog = await getOperationLog();

  return {
    transportTypes: typesResult.rows.map((row) => ({
      code: row.code,
      label: row.label
    })),
    points,
    activeRentals: rentalsResult.rows.map((row) => ({
      id: row.id,
      rentedAt: row.rented_at,
      transportTypeCode: row.transport_type_code,
      transportTypeLabel: row.transport_type_label,
      sourcePointCode: row.source_point_code,
      sourcePointName: row.source_point_name
    })),
    operationLog
  };
}

async function getPointStatus(pointCode) {
  const state = await getState();
  const point = state.points.find((item) => item.code === normalizeCode(pointCode));

  if (!point) {
    throw new AppError("Пункт проката не найден.");
  }

  return point;
}

async function addTransport({ pointCode, transportTypeCode, quantity }) {
  const normalizedPointCode = normalizeCode(pointCode);
  const normalizedTypeCode = normalizeCode(transportTypeCode);
  const parsedQuantity = parseQuantity(quantity);

  const result = await withTransaction(async (client) => {
    const point = await getPointByCode(client, normalizedPointCode);
    const transportType = await getTypeByCode(client, normalizedTypeCode);
    const currentTotal = await getPointTotal(client, point.id);

    if (currentTotal + parsedQuantity > point.capacity) {
      throw new AppError("В выбранном пункте проката недостаточно свободного места.");
    }

    await client.query(
      `
        UPDATE inventory
        SET available_count = available_count + $1
        WHERE point_id = $2 AND transport_type_id = $3
      `,
      [parsedQuantity, point.id, transportType.id]
    );

    const message = `${transportType.label} (${parsedQuantity} шт.) добавлен в ${point.name}.`;

    await writeOperationLog(client, {
      type: "add",
      message,
      pointCode: point.code,
      transportTypeCode: transportType.code,
      quantity: parsedQuantity
    });

    return { message };
  });

  await saveSnapshot();
  return result;
}

async function buildRentalId(client) {
  const result = await client.query("SELECT nextval('rental_id_seq') AS value");
  const nextValue = Number(result.rows[0].value);
  return `RID-${String(nextValue).padStart(4, "0")}`;
}

async function rentTransport({ pointCode, transportTypeCode, quantity, buy }) {
  const normalizedPointCode = normalizeCode(pointCode);
  const normalizedTypeCode = normalizeCode(transportTypeCode);
  const parsedQuantity = parseQuantity(quantity);
  const buyMode = Boolean(buy);

  const result = await withTransaction(async (client) => {
    const point = await getPointByCode(client, normalizedPointCode);
    const transportType = await getTypeByCode(client, normalizedTypeCode);
    const availableCount = await getAvailableCount(client, point.id, transportType.id);

    if (availableCount < parsedQuantity) {
      throw new AppError("На выбранной точке нет нужного количества транспорта.");
    }

    await client.query(
      `
        UPDATE inventory
        SET available_count = available_count - $1
        WHERE point_id = $2 AND transport_type_id = $3
      `,
      [parsedQuantity, point.id, transportType.id]
    );

    if (buyMode) {
      const message = `${transportType.label} куплен: ${parsedQuantity} шт. в ${point.name}.`;

      await writeOperationLog(client, {
        type: "buy",
        message,
        pointCode: point.code,
        transportTypeCode: transportType.code,
        quantity: parsedQuantity
      });

      return {
        message,
        rentalIds: []
      };
    }

    const rentalIds = [];

    for (let index = 0; index < parsedQuantity; index += 1) {
      const rentalId = await buildRentalId(client);

      await client.query(
        `
          INSERT INTO rentals (id, transport_type_id, source_point_id, status)
          VALUES ($1, $2, $3, 'active')
        `,
        [rentalId, transportType.id, point.id]
      );

      rentalIds.push(rentalId);
    }

    const message = `${transportType.label} выдан в прокат: ${parsedQuantity} шт.`;

    await writeOperationLog(client, {
      type: "rent",
      message,
      pointCode: point.code,
      transportTypeCode: transportType.code,
      quantity: parsedQuantity,
      rentalIds
    });

    return { message, rentalIds };
  });

  await saveSnapshot();
  return result;
}

async function returnTransport({ pointCode, rentalId }) {
  const normalizedPointCode = normalizeCode(pointCode);
  const normalizedRentalId = String(rentalId || "").trim().toUpperCase();

  if (!normalizedRentalId) {
    throw new AppError("Нужно выбрать идентификатор транспорта для возврата.");
  }

  const result = await withTransaction(async (client) => {
    const point = await getPointByCode(client, normalizedPointCode);
    const currentTotal = await getPointTotal(client, point.id);

    if (currentTotal + 1 > point.capacity) {
      throw new AppError("В выбранном пункте проката нет свободного места для возврата.");
    }

    const rentalResult = await client.query(
      `
        SELECT
          r.id,
          r.transport_type_id,
          t.label AS transport_type_label
        FROM rentals r
        JOIN transport_types t ON t.id = r.transport_type_id
        WHERE r.id = $1 AND r.status = 'active'
      `,
      [normalizedRentalId]
    );

    if (rentalResult.rowCount === 0) {
      throw new AppError("Выбранный транспорт уже возвращён или не найден.");
    }

    const rental = rentalResult.rows[0];

    await client.query(
      `
        UPDATE inventory
        SET available_count = available_count + 1
        WHERE point_id = $1 AND transport_type_id = $2
      `,
      [point.id, rental.transport_type_id]
    );

    await client.query(
      `
        UPDATE rentals
        SET status = 'returned',
            returned_at = NOW(),
            returned_point_id = $2
        WHERE id = $1
      `,
      [normalizedRentalId, point.id]
    );

    const message = `${rental.transport_type_label} с ID ${normalizedRentalId} возвращён в ${point.name}.`;

    await writeOperationLog(client, {
      type: "return",
      message,
      pointCode: point.code,
      quantity: 1,
      rentalIds: [normalizedRentalId]
    });

    return { message };
  });

  await saveSnapshot();
  return result;
}

module.exports = {
  getState,
  getOperationLog,
  getPointStatus,
  addTransport,
  rentTransport,
  returnTransport
};
