import { SiteFooter, SiteHeader } from '@/components/site-header';
import { ButtonLink } from '@/components/ui';

// Next's default 404 is an unstyled white card. This one wears the site's own header and colours.
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="page-in mx-auto flex min-h-[60vh] max-w-[63rem] flex-col items-start justify-center px-4 py-24 sm:px-8">
        <p className="label">404</p>
        <h1 className="display mt-3 max-w-[20ch] text-[2.5rem] font-medium sm:text-5xl">There is nothing at this address.</h1>
        <p className="mt-6 max-w-[52ch] text-[17px] leading-relaxed text-fg-2">The page may have moved, or the link was typed by hand. Everything Monday has is a click from the home page.</p>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <ButtonLink href="/" size="lg" className="px-6">Home</ButtonLink>
          <ButtonLink href="/system" size="lg" variant="ghost">How Monday works</ButtonLink>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
