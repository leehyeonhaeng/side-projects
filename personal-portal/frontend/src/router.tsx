import { createBrowserRouter } from "react-router";
import { HomePage } from "./modules/home/HomePage";
import { NotFoundPage } from "./modules/home/NotFoundPage";

export const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "*", element: <NotFoundPage /> },
]);
