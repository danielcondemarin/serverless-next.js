import { renderErrorPage } from "./error";
import { renderRoute } from "./default";
import { setCustomHeaders } from "./headers";
import { Fallback, FallbackRoute } from "./types";
import {
  Event,
  PageManifest,
  RenderRoute,
  Route,
  RoutesManifest,
  StaticRoute
} from "../types";
import { notFoundPage } from "../route/notfound";

const renderFallback = async (
  event: Event,
  route: FallbackRoute,
  manifest: PageManifest,
  routesManifest: RoutesManifest,
  getPage: (page: string) => any
): Promise<Fallback | StaticRoute | void> => {
  const { req, res } = event;
  setCustomHeaders(event, routesManifest);

  const page = getPage(route.page);
  try {
    const { html, renderOpts } = await page.renderReqToHTML(
      req,
      res,
      "passthrough"
    );
    return { isStatic: false, route, html, renderOpts };
  } catch (error) {
    return renderErrorPage(
      error,
      event,
      route,
      manifest,
      routesManifest,
      getPage
    );
  }
};

/*
 * Handles fallback routes
 *
 * If route is a blocking fallback or a fallback data route,
 * a Fallback object is returned. It contains the rendered page.
 *
 * Otherwise either a page is rendered (like handleDefault) or
 * returns as StaticRoute for the caller to handle.
 */
export const handleFallback = async (
  event: Event,
  route: Route,
  manifest: PageManifest,
  routesManifest: RoutesManifest,
  getPage: (page: string) => any
): Promise<StaticRoute | Fallback | void> => {
  // This should not be needed if all SSR routes are handled correctly
  if (route.isRender) {
    return renderRoute(
      event,
      route as RenderRoute,
      manifest,
      routesManifest,
      getPage
    );
  }

  if (route.isStatic) {
    const staticRoute = route as StaticRoute;
    const shouldRender =
      (staticRoute.fallback && staticRoute.isData) ||
      staticRoute.fallback === null;
    if (shouldRender && staticRoute.page) {
      const fallback: FallbackRoute = staticRoute as FallbackRoute;
      return renderFallback(event, fallback, manifest, routesManifest, getPage);
    }
    if (staticRoute.fallback) {
      return { ...staticRoute, file: `pages${staticRoute.fallback}` };
    }
  }

  const errorRoute = notFoundPage(
    event.req.url ?? "",
    manifest,
    routesManifest
  );
  if (errorRoute.isStatic) {
    return errorRoute as StaticRoute;
  }

  return renderRoute(event, errorRoute, manifest, routesManifest, getPage);
};
