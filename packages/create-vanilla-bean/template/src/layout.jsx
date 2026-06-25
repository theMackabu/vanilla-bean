{{tw_css}}import { Head } from "vanilla-bean";

export default function Layout({ children }{{children_t}}) {
  return (
    <Fragment>
      <Head>
        <title>{{name}}</title>
      </Head>
      <main>{children}</main>
    </Fragment>
  );
}
