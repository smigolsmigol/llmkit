import { createHttpsRedirectResponse } from '../../src/lib/public-recovery';

export default {
  fetch(request: Request): Response {
    return createHttpsRedirectResponse(new URL(request.url)) ?? new Response(null, { status: 204 });
  },
};
