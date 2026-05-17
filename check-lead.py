import psycopg2

conn = psycopg2.connect(
    host='db.fpnoyngotalmtxnhjldh.supabase.co',
    port=5432,
    dbname='postgres',
    user='postgres',
    password='Tafsheenmain',
    sslmode='require'
)
cur = conn.cursor()
cur.execute('SELECT id, "firstName", "lastName", phone, email, "targetCountry", "sourceChannel", status, "createdAt" FROM crm.leads ORDER BY "createdAt" DESC LIMIT 5')
rows = cur.fetchall()
print('5 most recent leads:')
for r in rows:
    print(f'  {r[8].strftime("%Y-%m-%d %H:%M")} | {r[1]} {r[2]} | {r[3]} | {r[5]} | src={r[6]} | status={r[7]}')
conn.close()
