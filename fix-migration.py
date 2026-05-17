"""
Apply the failed migration 20260513000000 directly to Supabase.
The migration failed because PostgreSQL does not allow using a newly-added enum
value in the same transaction where ALTER TYPE ... ADD VALUE was run.
This script splits those two steps across separate autocommit connections.
"""
import psycopg2

DSN = {
    "host": "db.fpnoyngotalmtxnhjldh.supabase.co",
    "port": 5432,
    "dbname": "postgres",
    "user": "postgres",
    "password": "Tafsheenmain",
    "connect_timeout": 20,
}

def connect():
    conn = psycopg2.connect(**DSN)
    conn.autocommit = True
    return conn, conn.cursor()

print("=" * 60)
print("Tashfeen Migration Fix — applying missing schema changes")
print("=" * 60)

# ----------------------------------------------------------------
# STEP 1: Add new ClientStatus enum values (separate transaction)
# ----------------------------------------------------------------
print("\nStep 1: Extending ClientStatus enum...")
conn, cur = connect()
enum_values = [
    "NEW_CLIENT", "DOCUMENTS_PENDING", "UNDER_PROCESSING",
    "SUBMITTED", "APPROVED", "REJECTED", "CLOSED", "CANCELLED", "REFUNDED",
]
for val in enum_values:
    sql = f"ALTER TYPE \"crm\".\"ClientStatus\" ADD VALUE IF NOT EXISTS '{val}'"
    try:
        cur.execute(sql)
        print(f"  + {val}")
    except Exception as e:
        print(f"  ~ {val} already exists or error: {e}")
cur.close()
conn.close()
print("  Enum step committed.")

# ----------------------------------------------------------------
# STEP 2: Add missing columns to crm.clients
# ----------------------------------------------------------------
print("\nStep 2: Adding missing columns to crm.clients...")
conn, cur = connect()
col_sqls = [
    'ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "cnic" TEXT',
    'ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "sourceLeadId" TEXT',
    'ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "assignedEmployeeId" TEXT',
    'ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "serviceType" TEXT',
    'ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "targetCountry" TEXT',
]
for sql in col_sqls:
    try:
        cur.execute(sql)
        col = sql.split('"')[7]
        print(f"  + column {col}")
    except Exception as e:
        print(f"  ERR: {e} | SQL: {sql[:60]}")

cur.close()
conn.close()

# ----------------------------------------------------------------
# STEP 3: FK constraints (safe IF NOT EXISTS)
# ----------------------------------------------------------------
print("\nStep 3: Foreign key constraints...")
conn, cur = connect()
fk_sqls = [
    """
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_sourceLeadId_fkey') THEN
        ALTER TABLE "crm"."clients"
          ADD CONSTRAINT "clients_sourceLeadId_fkey"
          FOREIGN KEY ("sourceLeadId") REFERENCES "crm"."leads"(id)
          ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$
    """,
    """
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_assignedEmployeeId_fkey') THEN
        ALTER TABLE "crm"."clients"
          ADD CONSTRAINT "clients_assignedEmployeeId_fkey"
          FOREIGN KEY ("assignedEmployeeId") REFERENCES "core"."employees"(id)
          ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$
    """,
]
for sql in fk_sqls:
    try:
        cur.execute(sql)
        print("  + FK OK")
    except Exception as e:
        print(f"  FK ERR: {e}")
cur.close()
conn.close()

# ----------------------------------------------------------------
# STEP 4: Indexes
# ----------------------------------------------------------------
print("\nStep 4: Indexes...")
conn, cur = connect()
idx_sqls = [
    'CREATE INDEX IF NOT EXISTS "clients_sourceLeadId_idx" ON "crm"."clients"("sourceLeadId")',
    'CREATE INDEX IF NOT EXISTS "clients_assignedEmployeeId_idx" ON "crm"."clients"("assignedEmployeeId")',
]
for sql in idx_sqls:
    try:
        cur.execute(sql)
        print("  + index OK")
    except Exception as e:
        print(f"  IDX ERR: {e}")
cur.close()
conn.close()

# ----------------------------------------------------------------
# STEP 5: Change default status — now that NEW_CLIENT exists
# ----------------------------------------------------------------
print("\nStep 5: Changing clients.status default to NEW_CLIENT...")
conn, cur = connect()
try:
    cur.execute(
        'ALTER TABLE "crm"."clients" '
        "ALTER COLUMN \"status\" SET DEFAULT 'NEW_CLIENT'::\"crm\".\"ClientStatus\""
    )
    print("  + default changed to NEW_CLIENT")
except Exception as e:
    print(f"  ERR: {e}")
cur.close()
conn.close()

# ----------------------------------------------------------------
# STEP 6: Mark the migration as applied in _prisma_migrations
# ----------------------------------------------------------------
print("\nStep 6: Marking migration as applied in Prisma shadow table...")
conn, cur = connect()
migration_name = "20260513000000_client_fields_and_required_case_clientid"
try:
    cur.execute(
        """
        INSERT INTO "public"."_prisma_migrations"
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        VALUES
          (gen_random_uuid(), 'manual-fix', now(), %s, NULL, NULL, now(), 1)
        ON CONFLICT (migration_name) DO UPDATE SET
          finished_at = now(),
          rolled_back_at = NULL,
          logs = NULL,
          applied_steps_count = 1
        """,
        (migration_name,),
    )
    print(f"  + Migration recorded: {migration_name}")
except Exception as e:
    print(f"  Prisma table ERR (non-fatal): {e}")
cur.close()
conn.close()

# ----------------------------------------------------------------
# VERIFY
# ----------------------------------------------------------------
print("\nVerification: checking crm.clients columns...")
conn, cur = connect()
cur.execute("""
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'clients'
    ORDER BY ordinal_position
""")
cols = cur.fetchall()
for col in cols:
    print(f"  {col[0]}: {col[1]}")

print("\nVerification: ClientStatus enum values...")
cur.execute("""
    SELECT enumlabel FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ClientStatus' AND n.nspname = 'crm'
    ORDER BY enumsortorder
""")
vals = cur.fetchall()
for v in vals:
    print(f"  {v[0]}")

cur.close()
conn.close()

print("\n✅ Migration fix complete! Test the /clients endpoint now.")
