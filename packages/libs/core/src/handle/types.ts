import { Event, StaticRoute } from "../types";

export type FallbackRoute = StaticRoute & {
  fallback: string | null;
  page: string;
};

export type Fallback = {
  isStatic: false;
  route: FallbackRoute;
  html: string;
  renderOpts: any;
};

export type Handler = {
  // Get and require() a page js file
  getPage: (file: string) => any;
  /*
   * Get a static file
   *
   * Should return a boolean indicating success.
   * On success, the results should be in event.res.
   */
  getFile: (event: Event, route: StaticRoute) => Promise<boolean>;
  // Save a static page html+json and resolve as response.
  putFiles: (event: Event, fallback: Fallback) => Promise<void>;
};
