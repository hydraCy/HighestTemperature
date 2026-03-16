PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  city_name TEXT NOT NULL DEFAULT 'Shanghai',
  event_id TEXT NOT NULL,
  market_slug TEXT NOT NULL UNIQUE,
  market_title TEXT NOT NULL,
  rules_text TEXT NOT NULL,
  volume REAL,
  target_date TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_markets_city_target_date ON markets(city_name, target_date);

CREATE TABLE IF NOT EXISTS market_bins (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  outcome_label TEXT NOT NULL,
  outcome_index INTEGER NOT NULL,
  market_price REAL NOT NULL,
  no_market_price REAL,
  best_bid REAL,
  best_ask REAL,
  spread REAL,
  implied_probability REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE,
  UNIQUE(market_id, outcome_index)
);
CREATE INDEX IF NOT EXISTS idx_market_bins_market_id ON market_bins(market_id);

CREATE TABLE IF NOT EXISTS resolution_metadata (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL UNIQUE,
  station_name TEXT NOT NULL,
  station_code TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  precision_rule TEXT NOT NULL,
  finalized_rule TEXT NOT NULL,
  revision_rule TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS weather_assist_snapshots (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  temperature_2m REAL NOT NULL,
  humidity REAL,
  cloud_cover REAL,
  precipitation REAL,
  wind_speed REAL,
  temp_1h_ago REAL,
  temp_2h_ago REAL,
  temp_3h_ago REAL,
  temp_rise_1h REAL,
  temp_rise_2h REAL,
  temp_rise_3h REAL,
  max_temp_so_far REAL NOT NULL,
  raw_json TEXT,
  FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_weather_market_observed ON weather_assist_snapshots(market_id, observed_at);

CREATE TABLE IF NOT EXISTS model_runs (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  model_version TEXT NOT NULL,
  best_bin TEXT NOT NULL,
  edge REAL NOT NULL,
  trade_score REAL NOT NULL,
  decision TEXT NOT NULL,
  recommended_position REAL NOT NULL,
  timing_score REAL NOT NULL,
  weather_score REAL NOT NULL,
  data_quality_score REAL NOT NULL,
  explanation TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL,
  raw_features_json TEXT NOT NULL,
  FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_model_runs_market_run_at ON model_runs(market_id, run_at);

CREATE TABLE IF NOT EXISTS model_bin_outputs (
  id TEXT PRIMARY KEY,
  model_run_id TEXT NOT NULL,
  outcome_label TEXT NOT NULL,
  model_probability REAL NOT NULL,
  market_price REAL NOT NULL,
  edge REAL NOT NULL,
  FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_model_bin_outputs_model_run_id ON model_bin_outputs(model_run_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  model_run_id TEXT,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  market_prices_json TEXT NOT NULL,
  weather_features_json TEXT NOT NULL,
  model_output_json TEXT NOT NULL,
  trading_output_json TEXT NOT NULL,
  explanation_text TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL,
  FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE,
  FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_market_captured ON snapshots(market_id, captured_at);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  note_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notes_market_created ON notes(market_id, created_at);

CREATE TABLE IF NOT EXISTS settled_results (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL UNIQUE,
  final_outcome_label TEXT NOT NULL,
  final_value REAL NOT NULL,
  settled_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS forecast_source_biases (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  snapshot_id TEXT,
  source_code TEXT NOT NULL,
  source_group TEXT NOT NULL,
  forecast_date TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  predicted_max REAL NOT NULL,
  final_max REAL NOT NULL,
  bias REAL NOT NULL,
  abs_error REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE SET NULL,
  UNIQUE(market_id, source_code, forecast_date)
);
CREATE INDEX IF NOT EXISTS idx_bias_market_forecast_source ON forecast_source_biases(market_id, forecast_date, source_code);
