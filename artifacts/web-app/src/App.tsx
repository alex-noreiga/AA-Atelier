import {
  Switch,
  Route,
  Router as WouterRouter,
  Redirect,
  useSearch,
} from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { SkipLink } from "@/components/skip-link";
import { RouteFocus } from "@/components/route-focus";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Track from "@/pages/track";
import OrderForm from "@/pages/order-form";
import Services from "@/pages/services";
import About from "@/pages/about";
import Shop from "@/pages/shop";
import ShopSuccess from "@/pages/shop-success";
import InvoicePage from "@/pages/invoice";
import Contact from "@/pages/contact";
import Appointments from "@/pages/appointments";
import AppointmentManage from "@/pages/appointment-manage";
import AccountLogin from "@/pages/account-login";
import AccountCallback from "@/pages/account-callback";
import AccountReset from "@/pages/account-reset";
import Account from "@/pages/account";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import ShippingReturns from "@/pages/shipping-returns";
import { CartProvider } from "@/lib/cart";
import { AuthProvider } from "@/lib/auth-context";
import { ConsentProvider } from "@/lib/consent";
import CookieConsentBanner from "@/components/cookie-consent-banner";
import ConsentedAnalytics from "@/components/analytics";

const queryClient = new QueryClient();

// The two order-tracking flows were consolidated onto `/track`. Keep the old
// URLs working (bookmarks, the Stripe cancel_url, links out in the wild) by
// redirecting them there, preserving any `?orderNumber=…` prefill.
function LegacyTrackRedirect() {
  const search = useSearch();
  return <Redirect to={`/track${search ? `?${search}` : ""}`} replace />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/services" component={Services} />
      <Route path="/about" component={About} />
      <Route path="/shop" component={Shop} />
      <Route path="/shop/success" component={ShopSuccess} />
      <Route path="/track" component={Track} />
      {/* Legacy tracking URLs → /track. Must precede the /shop/:productId param
          route below so they aren't shadowed by it. */}
      <Route path="/shop/status" component={LegacyTrackRedirect} />
      <Route path="/shop/order-status" component={LegacyTrackRedirect} />
      {/* Must follow the literal /shop/* routes: Switch takes the first match,
          so a param route above them would shadow /shop/success. */}
      <Route path="/shop/:productId" component={Shop} />
      <Route path="/invoice/:orderNumber" component={InvoicePage} />
      <Route path="/order" component={OrderForm} />
      {/* Self-service reschedule/cancel from the confirmation-email link. Placed
          before /appointments (wouter matches exact paths, but keep it explicit). */}
      <Route path="/appointments/manage" component={AppointmentManage} />
      <Route path="/appointments" component={Appointments} />
      {/* Account portal. The literal sub-routes must precede /account so they
          aren't shadowed, and /account itself redirects to login when
          unauthenticated. /account/callback is the Supabase OAuth/magic-link
          redirect target; /account/reset is the password-reset target. */}
      <Route path="/account/login" component={AccountLogin} />
      <Route path="/account/callback" component={AccountCallback} />
      <Route path="/account/reset" component={AccountReset} />
      <Route path="/account" component={Account} />
      <Route path="/contact" component={Contact} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/shipping-returns" component={ShippingReturns} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <ConsentProvider>
            <CartProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <SkipLink />
                <RouteFocus />
                <Navbar />
                <Router />
                <Footer />
                <CookieConsentBanner />
                <ConsentedAnalytics />
              </WouterRouter>
            </CartProvider>
          </ConsentProvider>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
