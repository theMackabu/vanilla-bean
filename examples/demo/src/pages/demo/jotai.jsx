import { atom } from "jotai/vanilla";
import { useAtom } from "vanilla-bean/jotai";
import { Button } from "../../components/button";

const countAtom = atom(0);

export default function JotaiDemo() {
  const [count, setCount] = useAtom(countAtom);
  return (
    <div>
      <h3 class="text-lg">jotai atom</h3>
      <Button onClick={() => setCount((c) => c + 1)}>count: {count()}</Button>
    </div>
  );
}
