-- Farm calendar: absences, shareholder visits, leave requests with approval workflow
CREATE TABLE IF NOT EXISTS farm_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES farms(id) DEFAULT default_farm_id(),
  entry_type text NOT NULL CHECK (entry_type IN (
    'leave', 'business_trip', 'sick', 'shareholder_visit'
  )),
  person_name text NOT NULL,
  person_role text CHECK (person_role IN (
    'farmverwalter', 'verwaltung', 'gesellschafter', 'other'
  )),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  notes text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'approved', 'rejected'
  )),
  requested_by uuid REFERENCES auth.users(id),
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  reminder_sent boolean DEFAULT false,
  google_event_id text,
  created_at timestamptz DEFAULT now(),
  CHECK (end_date >= start_date)
);

ALTER TABLE farm_calendar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "farm_read" ON farm_calendar FOR SELECT TO authenticated
  USING (farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "farm_insert" ON farm_calendar FOR INSERT TO authenticated
  WITH CHECK (farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "farm_update" ON farm_calendar FOR UPDATE TO authenticated
  USING (
    farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid())
    AND (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'owner'
      OR (requested_by = auth.uid() AND status = 'requested')
    )
  );

CREATE POLICY "farm_delete" ON farm_calendar FOR DELETE TO authenticated
  USING (
    farm_id = (SELECT farm_id FROM profiles WHERE id = auth.uid())
    AND (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'owner'
      OR (requested_by = auth.uid() AND status = 'requested')
    )
  );
