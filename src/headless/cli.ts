import { runCli } from "./run";

runCli(process.argv.slice(2), { env: process.env, out: (s) => console.log(s), err: (s) => console.error(s) }).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exit(1);
  },
);
