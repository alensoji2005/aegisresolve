import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../app.js';
import { userOf } from '../auth/plugin.js';
import { ApiError } from '../errors.js';
import { downloadEvidence, listEvidence, uploadEvidence, verifyEvidence } from './service.js';

type P = { Params: { id: string; eid: string } };

export function evidenceRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.post<P>('/cases/:id/evidence', async (req, reply) => {
      const user = userOf(req);
      const file = await req.file();
      if (!file) throw new ApiError(400, 'INVALID_ARG', 'file is required');
      const data = await file.toBuffer();
      return reply.status(201).send(await uploadEvidence(deps, user, req.params.id, { filename: file.filename, data }));
    });

    app.get<P>('/cases/:id/evidence', async (req) => listEvidence(deps, userOf(req), req.params.id));

    app.get<P>('/cases/:id/evidence/:eid/verify', async (req) => verifyEvidence(deps, userOf(req), req.params.id, req.params.eid));

    app.get<P>('/cases/:id/evidence/:eid/download', async (req, reply) => {
      const f = await downloadEvidence(deps, userOf(req), req.params.id, req.params.eid);
      const ascii = f.filename.replace(/[^\w.-]/g, '_');
      return reply
        .header('content-type', f.mimeType)
        .header('content-disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`)
        .header('x-content-type-options', 'nosniff')
        .send(f.data);
    });
  };
}
