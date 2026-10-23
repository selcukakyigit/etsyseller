import { createElement as h } from "react";
export default function Link({ href, children, ...rest }) { return h("a", { href, ...rest }, children); }
