import { Head, signal } from "vanilla-bean";
import { bump } from "../../actions/demo";

export default function ActionDemo() {
  const result = signal(null);

  const onClick = async () => {
    result("…");
    result(JSON.stringify(await bump(), null, 2));
  };

  return (
    <Fragment>
      <Head>
        <title>server action</title>
      </Head>
      <h3>server action</h3>
      <p>
        Runs <code>bump()</code> on the server
      </p>
      <button onClick={onClick}>bump on server</button>
      <pre>{result ?? "(click)"}</pre>
    </Fragment>
  );
}
