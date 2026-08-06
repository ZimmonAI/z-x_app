import { down, reset, testPool } from './db-helper.js';
test('migration up, rollback, and reapply preserve the additive phase schema', async () => {
    const pool = testPool();
    await reset(pool);
    expect((await pool.query("select count(*)::int n from information_schema.tables where table_schema='execution'")).rows[0].n).toBe(8);
    expect((await pool.query("select obj_description('execution.executions'::regclass) c")).rows[0].c).toContain('Ref: z-kn/');
    expect((await pool.query("select obj_description('execution.execution_phase_attempts'::regclass) c")).rows[0].c).toContain('Video Maker');
    expect((await pool.query("select pg_get_functiondef('execution.guard_video_maker_regeneration()'::regprocedure) definition")).rows[0].definition).toContain('CASE current_tool_key');
    expect((await pool.query(`select count(*)::int n
           from pg_trigger
          where tgrelid='execution.executions'::regclass
            and tgname='executions_video_maker_regeneration_guard'
            and not tgisinternal`)).rows[0].n).toBe(1);
    await down(pool);
    expect((await pool.query("select to_regnamespace('execution') is null gone")).rows[0].gone).toBe(true);
    await reset(pool);
    expect((await pool.query("select to_regclass('execution.execution_phase_attempts') is not null present")).rows[0].present).toBe(true);
    await down(pool);
    await pool.end();
});
//# sourceMappingURL=migration-up-down.test.js.map