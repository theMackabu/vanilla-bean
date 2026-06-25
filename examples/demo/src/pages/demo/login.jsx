import { login } from "../../actions/auth";

export default function Login() {
  return (
    <Fragment>
      <h3 class="text-lg">login</h3>
      <button onClick={() => login("ada")}>log in as ada</button>
    </Fragment>
  );
}
