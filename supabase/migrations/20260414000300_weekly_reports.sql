-- Weekly work reports: track daily activities per employee
CREATE TABLE farm_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES farms(id) DEFAULT default_farm_id(),
  name text NOT NULL,
  role text,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(farm_id, name)
);

ALTER TABLE farm_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "farm_read" ON farm_employees FOR SELECT TO authenticated
  USING (farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "farm_insert" ON farm_employees FOR INSERT TO authenticated
  WITH CHECK (farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "farm_update" ON farm_employees FOR UPDATE TO authenticated
  USING (farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "farm_delete" ON farm_employees FOR DELETE TO authenticated
  USING (farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid()));

-- Seed known employees from salary data
INSERT INTO farm_employees (name, role, sort_order) VALUES
  ('Werner Jacobi', 'Farmverwalter', 1),
  ('Wanda Jacobi', 'Verwaltung', 2),
  ('John Katambo', 'Farmarbeiter', 10),
  ('Otto Janjantjies', 'Farmarbeiter', 11),
  ('Ivon Eises', 'Farmarbeiter', 12),
  ('Cecilie Frederick', 'Farmarbeiter', 13),
  ('Silvanus Shapaka', 'Farmarbeiter', 14),
  ('Andreas Ndafongho', 'Farmarbeiter', 15),
  ('Teofelus Korneliu', 'Farmarbeiter', 16);

CREATE TABLE work_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES farms(id) DEFAULT default_farm_id(),
  week_start date NOT NULL,
  employee_name text NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  activity text,
  hours numeric,
  notes text,
  recorded_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(farm_id, week_start, employee_name, day_of_week)
);

ALTER TABLE work_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "farm_read" ON work_entries FOR SELECT TO authenticated
  USING (farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "farm_insert" ON work_entries FOR INSERT TO authenticated
  WITH CHECK (farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "farm_update" ON work_entries FOR UPDATE TO authenticated
  USING (farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "farm_delete" ON work_entries FOR DELETE TO authenticated
  USING (farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX idx_work_entries_week ON work_entries(week_start, employee_name);
