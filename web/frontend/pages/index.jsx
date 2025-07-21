import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Badge,
  Banner,
  Spinner,
  Icon,
  Grid,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useQuery } from "react-query";
import {
  ProductIcon,
  PersonIcon,
  OrderIcon,
  SettingsIcon,
  CheckIcon,
  AlertCircleIcon,
} from "@shopify/polaris-icons";

export default function HomePage() {
  // Fetch sync status
  const { data: syncStatus, isLoading: isLoadingSync } = useQuery({
    queryKey: ["sync-status"],
    queryFn: async () => {
      const response = await fetch("/api/sync/status");
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  // Fetch basic stats
  const { data: vendorsData, isLoading: isLoadingVendors } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const response = await fetch("/api/vendor/list");
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  const isLoading = isLoadingSync || isLoadingVendors;

  const getInitialSyncStatus = () => {
    if (isLoadingSync) return null;

    if (syncStatus?.hasRunningSyncs) {
      return (
        <Banner status="info" icon={AlertCircleIcon}>
          <p>Initial sync is in progress. Data will be available shortly.</p>
        </Banner>
      );
    }

    if (!syncStatus?.initialSyncCompleted) {
      return (
        <Banner status="warning" icon={AlertCircleIcon}>
          <p>
            Initial sync not completed. Visit the Debug page to start manual
            sync.
          </p>
        </Banner>
      );
    }

    return (
      <Banner status="success" icon={CheckIcon}>
        <p>App is ready! All data has been synced successfully.</p>
      </Banner>
    );
  };

  const navigationCards = [
    {
      title: "Products",
      description: `View and manage ${
        syncStatus?.counts?.products || 0
      } products`,
      icon: ProductIcon,
      href: "/products",
      count: syncStatus?.counts?.products || 0,
      color: "primary",
    },
    {
      title: "Vendors",
      description: `Manage ${syncStatus?.counts?.vendors || 0} vendor contacts`,
      icon: PersonIcon,
      href: "/vendors",
      count: syncStatus?.counts?.vendors || 0,
      color: "success",
    },
    {
      title: "Orders",
      description: `Track ${syncStatus?.counts?.orders || 0} orders`,
      icon: OrderIcon,
      href: "/orders",
      count: syncStatus?.counts?.orders || 0,
      color: "warning",
    },
    {
      title: "Debug & Sync",
      description: "Test sync and debug tools",
      icon: SettingsIcon,
      href: "/debug",
      count: null,
      color: "info",
    },
  ];

  return (
    <Page>
      <TitleBar title="Vendor Alert Dashboard" />
      <Layout>
        <Layout.Section>
          {/* Welcome Card */}
          <Card>
            <BlockStack vertical spacing="loose">
              <Text variant="headingLg" as="h1">
                Welcome to Vendor Alert! 🎉
              </Text>
              <Text variant="bodyMd" tone="subdued">
                Your complete vendor management solution for Shopify. Track
                products, manage vendor contacts, and monitor orders all in one
                place.
              </Text>

              {getInitialSyncStatus()}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {/* Navigation Cards */}
          <Grid>
            {navigationCards.map((card, index) => (
              <Grid.Cell
                key={index}
                columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}
              >
                <Card>
                  <BlockStack vertical alignment="center" spacing="tight">
                    <div
                      style={{
                        padding: "1rem",
                        borderRadius: "50%",
                        backgroundColor: "var(--p-color-bg-surface-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon source={card.icon} />
                    </div>

                    <Text variant="headingMd" alignment="center">
                      {card.title}
                    </Text>

                    {card.count !== null && (
                      <Badge status={card.color}>
                        {isLoading ? "..." : card.count}
                      </Badge>
                    )}

                    <Text variant="bodySm" tone="subdued" alignment="center">
                      {card.description}
                    </Text>

                    <Button
                      primary={index === 0}
                      onClick={() => (window.location.href = card.href)}
                      fullWidth
                    >
                      Open {card.title}
                    </Button>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            ))}
          </Grid>
        </Layout.Section>

        {/* Quick Stats */}
        <Layout.Section>
          <Layout>
            <Layout.Section oneHalf>
              <Card title="Vendor Overview" sectioned>
                {isLoading ? (
                  <div style={{ textAlign: "center", padding: "1rem" }}>
                    <Spinner size="small" />
                  </div>
                ) : (
                  <BlockStack gap="200">
                    {vendorsData?.vendors?.length > 0 ? (
                      vendorsData.vendors.slice(0, 5).map((vendor, index) => (
                        <BlockStack
                          key={index}
                          distribution="equalSpacing"
                          alignment="center"
                        >
                          <Text variant="bodyMd" fontWeight="medium">
                            {vendor.name}
                          </Text>
                          <BlockStack spacing="tight">
                            <Badge tone="info">
                              {vendor.productCount || 0} products
                            </Badge>
                            <Badge tone="success">
                              {vendor.orderCount || 0} orders
                            </Badge>
                          </BlockStack>
                        </BlockStack>
                      ))
                    ) : (
                      <Text variant="bodySm" tone="subdued">
                        No vendors found. Vendors will appear automatically when
                        products are synced.
                      </Text>
                    )}

                    {vendorsData?.vendors?.length > 5 && (
                      <Button
                        plain
                        onClick={() => (window.location.href = "/vendors")}
                      >
                        View all {vendorsData.vendors.length} vendors
                      </Button>
                    )}
                  </BlockStack>
                )}
              </Card>
            </Layout.Section>

            <Layout.Section oneHalf>
              <Card title="Quick Actions" sectioned>
                <BlockStack vertical spacing="loose">
                  <Button
                    primary
                    fullWidth
                    onClick={() => (window.location.href = "/vendors")}
                  >
                    Manage Vendor Contacts
                  </Button>

                  <Button
                    fullWidth
                    onClick={() => (window.location.href = "/orders")}
                  >
                    View Recent Orders
                  </Button>

                  <Button
                    fullWidth
                    onClick={() => (window.location.href = "/debug")}
                  >
                    Sync Data & Debug
                  </Button>

                  <Text variant="bodySm" tone="subdued" alignment="center">
                    Need help? Check out the documentation or contact support.
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
