-- =============================================
-- Migration 003: Tasks Board (Corcho de Tareas)
-- =============================================

-- Task priority type
CREATE TYPE task_priority AS ENUM ('high', 'medium', 'low');
-- Task status type
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed');

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  priority task_priority NOT NULL DEFAULT 'medium',
  status task_status NOT NULL DEFAULT 'pending',
  sort_order INTEGER NOT NULL DEFAULT 0,
  assigned_to UUID REFERENCES users_profile(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users_profile(id),
  related_entity_type TEXT, -- 'client', 'supply', 'prescoring', etc.
  related_entity_id UUID,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast queries by assignee and status
CREATE INDEX idx_tasks_assigned_status ON tasks(assigned_to, status);
CREATE INDEX idx_tasks_sort ON tasks(assigned_to, status, sort_order);

-- Updated at trigger
CREATE TRIGGER set_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- RLS policies
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Admins can see all tasks
CREATE POLICY tasks_admin_all ON tasks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'admin')
  );

-- Commercials can see tasks assigned to them or created by them
CREATE POLICY tasks_own ON tasks
  FOR SELECT USING (
    assigned_to = auth.uid() OR created_by = auth.uid()
  );

-- Users can update tasks assigned to them (e.g. mark complete)
CREATE POLICY tasks_update_own ON tasks
  FOR UPDATE USING (
    assigned_to = auth.uid()
  );
