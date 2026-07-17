export async function withTransaction(pool, fn) { const c = await pool.connect(); try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
}
catch (e) {
    await c.query('rollback');
    throw e;
}
finally {
    c.release();
} }
//# sourceMappingURL=transaction.js.map