import { setCustomHeaders } from "./headers";
import { redirect } from "./redirect";
import { toRequest } from "./request";
import { routeApi } from "../route";
import {
  ApiManifest,
  ApiRoute,
  Event,
  ExternalRoute,
  RedirectRoute,
  RoutesManifest,
  UnauthorizedRoute
} from "../types";
import { unauthorized } from "./unauthorized";

/*
 * Handles api routes.
 *
 * Returns ExternalRoute for handling in the caller.
 *
 * If return is void, the response has already been generated in
 * event.res/event.responsePromise which the caller should wait on.
 */
export const handleApi = async (
  event: Event,
  manifest: ApiManifest,
  routesManifest: RoutesManifest,
  getPage: (page: string) => any
): Promise<ExternalRoute | boolean> => {
  const request = toRequest(event);
  const route = routeApi(request, manifest, routesManifest);

  if (!route) {
    return false;
  }
  if (route.querystring) {
    event.req.url = `${event.req.url}${request.querystring ? "&" : "?"}${
      route.querystring
    }`;
  }
  if (route.isApi) {
    const { page } = route as ApiRoute;
    setCustomHeaders(event, routesManifest);
    getPage(page).default(event.req, event.res);
    return true;
  }
  if (route.isRedirect) {
    redirect(event, route as RedirectRoute);
    return true;
  }
  if (route.isUnauthorized) {
    unauthorized(event, route as UnauthorizedRoute);
    return true;
  }
  // No if lets typescript check this is ExternalRoute
  return route;
};
