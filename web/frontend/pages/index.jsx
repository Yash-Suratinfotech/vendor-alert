import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  Icon,
  Grid,
  Frame,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useQuery } from "react-query";
import {
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
        <Banner tone="info" icon={AlertCircleIcon}>
          <p>Initial sync is in progress. Data will be available shortly.</p>
        </Banner>
      );
    }

    if (!syncStatus?.initialSyncCompleted) {
      return (
        <Banner tone="warning" icon={AlertCircleIcon}>
          <p>
            Initial sync not completed. Visit the Debug page to start manual
            sync.
          </p>
        </Banner>
      );
    }

    return (
      <Banner tone="success" icon={CheckIcon}>
        <p>App is ready! All data has been synced successfully.</p>
      </Banner>
    );
  };

  const navigationCards = [
    {
      title: "Vendors",
      description: `Manage ${syncStatus?.counts?.vendors || 0} vendor contacts`,
      icon: PersonIcon,
      href: "/vendors",
      count: syncStatus?.counts?.vendors || 0,
      tone: "success",
    },
    {
      title: "Orders",
      description: `Track ${syncStatus?.counts?.orders || 0} orders`,
      icon: OrderIcon,
      href: "/orders",
      count: syncStatus?.counts?.orders || 0,
      tone: "warning",
    },
    {
      title: "Debug & Sync",
      description: "Test sync and debug tools",
      icon: SettingsIcon,
      href: "/debug",
      count: null,
      tone: "attention",
    },
  ];

  return (
    <Frame>
      <Page>
        <TitleBar title="Vendor Alert Dashboard" />
        <Layout>
          <Layout.Section>
            {/* Welcome Card */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingLg" as="h1">
                  Welcome to Vendor Alert! 🎉
                </Text>
                <Text variant="bodyMd" tone="subdued">
                  Your complete vendor management solution for Shopify. Track
                  products, manage vendor contacts, and monitor orders all in
                  one place.
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
                  columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}
                >
                  <Card>
                    <BlockStack gap="300" align="center">
                      <div
                        style={{
                          width: "50px",
                          height: "50px",
                          borderRadius: "50%",
                          backgroundColor:
                            "var(--p-color-bg-surface-secondary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          margin: "auto"
                        }}
                      >
                        <Icon source={card.icon} />
                      </div>

                      <Text variant="headingMd" alignment="center">
                        {card.title}
                      </Text>

                      <Text variant="bodySm" tone="subdued" alignment="center">
                        {card.description}
                      </Text>

                      <Button
                        variant={index === 0 ? "primary" : "secondary"}
                        onClick={() => (window.location.href = card.href)}
                        size="large"
                      >
                        Open {card.title}
                      </Button>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              ))}
            </Grid>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
