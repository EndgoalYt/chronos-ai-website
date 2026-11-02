import { getPublicLicenseJwks } from "../_shared/license.ts";
import { jsonResponse, requireGet, serve } from "../_shared/http.ts";

serve(async (request) => {
  requireGet(request);
  const response = jsonResponse(request, await getPublicLicenseJwks());
  response.headers.set("cache-control", "public, max-age=300, stale-while-revalidate=300");
  return response;
});
