import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // deals -> projects
      { source: "/crm/deals", destination: "/projects", permanent: true },
      { source: "/crm/deals/new", destination: "/projects/new", permanent: true },

      // customers
      { source: "/crm/customers", destination: "/customers", permanent: true },

      // calendar
      { source: "/calendar/team", destination: "/calendar", permanent: true },

      // settings
      { source: "/team/settings", destination: "/settings/members/invite", permanent: true },

      // employee -> unified dashboard
      { source: "/employee-dashboard", destination: "/dashboard", permanent: true },
      { source: "/employee-login", destination: "/login", permanent: true },
    ];
  },
};

export default nextConfig;
