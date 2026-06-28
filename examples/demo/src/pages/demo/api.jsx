import { Head, signal } from "vanilla-bean";
import { Button } from "../../components/button";

export default function ApiDemo() {
  const out = signal("(call a route)");

  const call = async (path, opts) => {
    out("loading…");
    try {
      const res = await fetch(path, opts);
      out(`${opts?.method ?? "GET"} ${path}  →  ${res.status}\n\n` + JSON.stringify(await res.json(), null, 2));
    } catch (e) {
      out("error: " + e.message);
    }
  };

  return (
    <Fragment>
      <Head>
        <title>api demo</title>
      </Head>
      <h3>api routes</h3>
      <p>
        File-based handlers under <code>src/api</code>, with <code>[id]</code> params and method exports.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button onClick={() => call("/api/hello?name=Ada")}>GET /api/hello</Button>
        <Button onClick={() => call("/api/users/7")}>GET /api/users/7</Button>
        <Button onClick={() => call("/api/status/418")}>GET /api/status/418</Button>
        <Button
          onClick={() =>
            call("/api/users/7", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ hi: true }),
            })
          }
        >
          POST /api/users/7
        </Button>
      </div>
      <pre class="mt-2 text-sm">{out}</pre>
    </Fragment>
  );
}
