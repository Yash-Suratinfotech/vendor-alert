import { BrowserRouter } from "react-router-dom";
import { NavMenu } from "@shopify/app-bridge-react";
import Routes from "./Routes";

import { QueryProvider, PolarisProvider } from "./components";

export default function App() {
  // Any .tsx or .jsx files in /pages will become a route
  // See documentation for <Routes /> for more info
  const pages = import.meta.glob("./pages/**/!(*.test.[jt]sx)*.([jt]sx)", {
    eager: true,
  });

  return (
    <PolarisProvider>
      <BrowserRouter>
        <QueryProvider>
          <NavMenu>
            <a href="/" rel="home" />
            <a href="/vendors" rel="vendors">
              Vendors
            </a>
            <a href="/debug" rel="Debug & Sync">
              Debug & Sync
            </a>
          </NavMenu>
          <Routes pages={pages} />
        </QueryProvider>
      </BrowserRouter>
    </PolarisProvider>
  );
}
