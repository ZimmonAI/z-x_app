export async function healthRoutes(app) { app.get('/internal/health', async () => ({ status: 'alive' })); }
//# sourceMappingURL=health.js.map