CREATE TABLE IF NOT EXISTS rental_points (
  id SERIAL PRIMARY KEY,
  code VARCHAR(16) NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0)
);

CREATE TABLE IF NOT EXISTS transport_types (
  id SERIAL PRIMARY KEY,
  code VARCHAR(16) NOT NULL UNIQUE,
  label VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  point_id INTEGER NOT NULL REFERENCES rental_points(id) ON DELETE CASCADE,
  transport_type_id INTEGER NOT NULL REFERENCES transport_types(id) ON DELETE CASCADE,
  available_count INTEGER NOT NULL DEFAULT 0 CHECK (available_count >= 0),
  PRIMARY KEY (point_id, transport_type_id)
);

CREATE TABLE IF NOT EXISTS rentals (
  id VARCHAR(32) PRIMARY KEY,
  transport_type_id INTEGER NOT NULL REFERENCES transport_types(id),
  source_point_id INTEGER NOT NULL REFERENCES rental_points(id),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned')),
  rented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  returned_at TIMESTAMPTZ,
  returned_point_id INTEGER REFERENCES rental_points(id)
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id SERIAL PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  message TEXT NOT NULL,
  point_code VARCHAR(16),
  transport_type_code VARCHAR(16),
  quantity INTEGER,
  rental_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS rental_id_seq START WITH 1;
