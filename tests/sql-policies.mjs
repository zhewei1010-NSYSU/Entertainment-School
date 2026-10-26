// Optional local PostgreSQL harness. Supabase Auth/Storage schemas are modeled here;
// this validates policy behavior, not the deployed Supabase service or Realtime delivery.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
const a = "6dcd01b4-50e8-4654-b95d-9e975ed11447",
  b = "9dcd01b4-50e8-4654-b95d-9e975ed11447";
try {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
 create table auth.users(id uuid primary key);
 insert into auth.users values('${a}'),('${b}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(name text primary key,bucket_id text);
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to anon,authenticated;
 grant all on storage.objects to anon,authenticated;
 create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
 create function storage.filename(name text) returns text language sql immutable as $$ select split_part(name,'/',array_length(string_to_array(name,'/'),1)) $$;
 -- Model an unrelated permissive shared-project policy: school guards must still deny leaks.
 create policy unrelated_permissive on storage.objects for all to public using(true) with check(true);
 `);
  let sql = await readFile(
    new URL(
      "../supabase/migrations/202610270001_school_cloud.sql",
      import.meta.url,
    ),
    "utf8",
  );
  sql = sql.replace(
    "alter publication supabase_realtime add table public.school_journals;",
    "-- Realtime publication is platform-owned; omitted in this local harness.",
  );
  await db.exec(sql);
  const actor = async (id) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  const save = async (id, revision, op) =>
    db.query(
      "select public.save_school_journal($1,$2::jsonb,$3,$4) as result",
      [id, JSON.stringify({ records: [], photos: [] }), revision, op],
    );
  await actor(a);
  const operation = crypto.randomUUID();
  const first = await save(a, 0, operation);
  assert.equal(first.rows[0].result.revision, 1);
  assert.equal((await save(a, 0, operation)).rows[0].result.revision, 1);
  await assert.rejects(
    () => save(a, 0, crypto.randomUUID()),
    (error) => error.code === "40001",
  );
  await assert.rejects(
    () => db.query("update public.school_journals set revision=99"),
    /permission denied/,
  );
  const path = a + "/" + crypto.randomUUID();
  await db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
    "school-photos",
    path,
  ]);
  await assert.rejects(
    () =>
      db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
        "school-photos",
        a + "/not-a-uuid",
      ]),
    /row-level security/,
  );
  await actor(b);
  await save(b, 0, crypto.randomUUID());
  assert.equal(
    (await db.query("select * from public.school_journals")).rows.length,
    1,
  );
  assert.equal(
    (
      await db.query("select * from public.school_journals where user_id=$1", [
        a,
      ])
    ).rows.length,
    0,
  );
  await assert.rejects(
    () => save(a, 1, crypto.randomUUID()),
    (error) => error.code === "28000",
  );
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    0,
  );
  await assert.rejects(
    () =>
      db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
        "school-photos",
        a + "/" + crypto.randomUUID(),
      ]),
    /row-level security/,
  );
  await actor(a);
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    1,
  );
  assert.equal(
    (await db.query("delete from storage.objects returning name")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("update storage.objects set name=name returning name")).rows
      .length,
    0,
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec("set role anon");
  await assert.rejects(
    () => db.query("select * from public.school_journals"),
    /permission denied/,
  );
  await assert.rejects(
    () => save(a, 1, crypto.randomUUID()),
    /permission denied/,
  );
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    0,
  );
  console.log(
    "PASS: SQL migration parses, own-row RLS, owner mismatch rejection, CAS/idempotency, anon denial and private immutable photo policies even with another permissive policy (local PostgreSQL harness; Realtime excluded).",
  );
} finally {
  await db.close();
}
