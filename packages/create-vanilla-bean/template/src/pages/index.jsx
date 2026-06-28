import { signal } from 'vanilla-bean';

function Counter() {
  let count = signal(0);
  return <button onClick={() => count++}>count: {count}</button>;
}

export default () => (
  <Fragment>
    <h1>hello from vanilla bean</h1>
    <Counter />
  </Fragment>
);
