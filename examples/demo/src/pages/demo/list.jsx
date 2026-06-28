import { Head, signal } from "vanilla-bean";
import { Button } from "../../components/button";

let nextId = 4;

export default function ListDemo() {
  const items = signal([
    { id: 1, label: "alpha" },
    { id: 2, label: "beta" },
    { id: 3, label: "gamma" },
  ]);

  const add = () => (items = [...items, { id: nextId, label: "item-" + nextId++ }]);
  const shuffle = () => (items = [...items].sort(() => Math.random() - 0.5));
  const removeFirst = () => (items = items.slice(1));

  return (
    <Fragment>
      <Head>
        <title>list</title>
      </Head>
      <h1 class="text-xl mb-3">Keyed list</h1>
      <div class="flex gap-x-2 mb-2">
        <Button onClick={add}>add</Button>
        <Button onClick={shuffle}>shuffle</Button>
        <Button onClick={removeFirst}>remove first</Button>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            #{item.id} - {item.label}
          </li>
        ))}
      </ul>
    </Fragment>
  );
}
