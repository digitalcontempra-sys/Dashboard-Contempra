import { PageHeader } from "../components/Layout";
import { Icon } from "../components/Icon";

export function MyCards() {
  return (
    <>
      <PageHeader title="My Cards" />
      <div className="px-4 md:px-8">
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
            <Icon name="cards" className="size-6" />
          </span>
          <p className="max-w-xs text-text-2">Your production cards will appear here soon.</p>
        </div>
      </div>
    </>
  );
}
