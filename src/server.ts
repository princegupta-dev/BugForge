import type { AddressInfo } from "node:net";
import app from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);

const server = app.listen(PORT, () => {
  const { port } = server.address() as AddressInfo;
  console.log(`Runtime Doctor running at http://localhost:${port}`);
});
