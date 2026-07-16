import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Status from "@/pages/status";
import OrderForm from "@/pages/order-form";
import Services from "@/pages/services";
import About from "@/pages/about";
import Shop from "@/pages/shop";
import Portfolio from "@/pages/portfolio";
import ShopSuccess from "@/pages/shop-success";
import ShopOrderStatus from "@/pages/shop-order-status";
import Contact from "@/pages/contact";
import Appointments from "@/pages/appointments";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import ShippingReturns from "@/pages/shipping-returns";
import { CartProvider } from "@/lib/cart";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/services" component={Services} />
      <Route path="/about" component={About} />
      <Route path="/portfolio" component={Portfolio} />
      <Route path="/shop" component={Shop} />
      <Route path="/shop/success" component={ShopSuccess} />
      <Route path="/shop/status" component={Status} />
      <Route path="/shop/order-status" component={ShopOrderStatus} />
      <Route path="/order" component={OrderForm} />
      <Route path="/appointments" component={Appointments} />
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
      <TooltipProvider>
        <CartProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Navbar />
            <Router />
            <Footer />
          </WouterRouter>
        </CartProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
