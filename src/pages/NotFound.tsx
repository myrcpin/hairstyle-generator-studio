import { Link } from "react-router-dom";
export default function NotFound() {
  return (
    <div className="container-x py-20">
      <h1 className="text-[48px]">Page not found.</h1>
      <Link to="/" className="btn-primary mt-6">Go home</Link>
    </div>
  );
}
