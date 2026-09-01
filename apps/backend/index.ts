import "dotenv/config";
import {prisma} from "db/client"
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 4000);

const app = createApp();
app.listen(port, () => {
  console.log(`backend listening on :${port}`);
});
