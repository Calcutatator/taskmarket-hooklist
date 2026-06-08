import { type Request, type Response, type NextFunction } from 'express';
import { type ZodTypeAny } from 'zod';

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Merge path params so OpenAPI clients that supply e.g. taskId via the URL
    // path rather than the JSON body are not incorrectly rejected.
    const result = schema.safeParse({ ...req.params, ...req.body });
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message).join('; ');
      res.status(400).json({ error: issues });
      return;
    }
    req.body = result.data;
    next();
  };
}
