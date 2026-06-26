import { addMessage, getMessages } from "../../actions/guestbook";

export const cache = false;

function Messages() {
  "use server";

  const list = getMessages();
  if (!list.length) return <p class="text-zinc-400 mt-3">no messages yet</p>;

  return (
    <ul class="mt-3 space-y-1">
      {list.map((m) => (
        <li>
          <span class="text-zinc-400">{m.at}</span>: {m.text}
        </li>
      ))}
    </ul>
  );
}

export default function FormDemo() {
  return (
    <div class="p-4">
      <h3 class="text-lg">guestbook</h3>
      <p class="text-zinc-400">a server action via &lt;form action={"{addMessage}"}&gt;, works without JS.</p>
      <form action={addMessage} class="flex gap-2 mt-3">
        <input name="text" placeholder="say something…" class="border-b outline-none" autocomplete="off" />
        <button type="submit" class="underline">
          post
        </button>
      </form>
      <Messages />
    </div>
  );
}
