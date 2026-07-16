import type { FastifyInstance } from 'fastify';export async function healthRoutes(app:FastifyInstance){app.get('/internal/health',async()=>({status:'alive'}))}
