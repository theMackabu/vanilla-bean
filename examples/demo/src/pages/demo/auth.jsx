import { cookies, redirect } from "vanilla-bean";
import { logout } from "../../actions/auth";

function Protected() {
  "use server";
  const user = cookies().get("session");
  if (!user) redirect("/demo/login");
  return (
    <p>
      logged in as <strong>{user}</strong>
    </p>
  );
}

export default function AuthDemo() {
  return (
    <Fragment>
      <h3 class="text-lg">protected page</h3>
      <Protected />
      <button onClick={() => logout()}>log out</button>
    </Fragment>
  );
}
