import { handleHooksRequest } from "../lib/hooks-http.js";

export default async function hooksHandler(req, res) {
  await handleHooksRequest(req, res);
}
