import { IncomingMessage, ServerResponse } from "http";

export async function createExternalRewriteResponse(
  customRewrite: string,
  req: IncomingMessage,
  res: ServerResponse,
  body?: string
): Promise<void> {
  const { default: fetch } = await import("node-fetch");

  // Set request headers
  const reqHeaders: any = {};
  Object.assign(reqHeaders, req.headers);

  // Delete host header otherwise request may fail due to host mismatch
  if (reqHeaders.hasOwnProperty("host")) {
    delete reqHeaders.host;
  }

  let fetchResponse;
  if (body) {
    const decodedBody = Buffer.from(body, "base64").toString("utf8");

    fetchResponse = await fetch(customRewrite, {
      headers: reqHeaders,
      method: req.method,
      body: decodedBody, // Must pass body as a string,
      compress: false,
      redirect: "manual"
    });
  } else {
    fetchResponse = await fetch(customRewrite, {
      headers: reqHeaders,
      method: req.method,
      compress: false,
      redirect: "manual"
    });
  }

  for (const [name, val] of fetchResponse.headers.entries()) {
    res.setHeader(name, val);
  }
  res.statusCode = fetchResponse.status;
  res.end(await fetchResponse.buffer());
}
