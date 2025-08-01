import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Text,
  EmptyState,
  Spinner,
  Filters,
  Select,
  Button,
  Pagination,
  Modal,
  List,
  BlockStack,
  InlineStack,
  Toast,
  Frame,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";
import { useQuery } from "react-query";
import { ViewIcon } from "@shopify/polaris-icons";
import { useMutation, useQueryClient } from "react-query";
import { useDebounce } from "../hooks/useDebounce";

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // 'all', 'active', 'cancelled'
  const [searchValue, setSearchValue] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const itemsPerPage = 25;

  // Debounce search value to prevent excessive API calls
  const debouncedSearchValue = useDebounce(searchValue, 300);

  // Fetch orders data with enhanced debugging
  const {
    data: ordersData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      "orders",
      vendorFilter,
      statusFilter,
      debouncedSearchValue,
      currentPage,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage,
        limit: itemsPerPage,
        ...(vendorFilter && { vendor: vendorFilter }),
        ...(debouncedSearchValue &&
          debouncedSearchValue.trim() && {
            search: debouncedSearchValue.trim(),
          }),
        includeCancelled:
          statusFilter === "all" || statusFilter === "cancelled"
            ? "true"
            : "false",
      });

      console.log("🔍 Fetching orders with params:", params.toString());

      const response = await fetch(`/api/orders?${params}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Orders API error:", response.status, errorText);
        throw new Error(`Failed to fetch orders: ${response.status}`);
      }

      const data = await response.json();

      // Client-side filtering for cancelled status
      if (statusFilter === "cancelled") {
        data.orders = data.orders.filter((order) => order.isCancelled);
        data.pagination.total = data.orders.length;
      } else if (statusFilter === "active") {
        data.orders = data.orders.filter((order) => !order.isCancelled);
        data.pagination.total = data.orders.length;
      }

      return data;
    },
    refetchOnWindowFocus: false,
    keepPreviousData: true,
    staleTime: 30000, // Cache for 30 seconds
    cacheTime: 300000, // Keep in cache for 5 minutes
    onError: (error) => {
      console.error("❌ Orders query error:", error);
    },
  });

  // Fetch vendors for filter dropdown
  const { data: vendorsData } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const response = await fetch("/api/vendor/list");
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  const getUserToken = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/token");
      if (response.ok) {
        const data = await response.json();
        setToken(data.token);
      } else {
        const errorData = await response.json();
        setToastMessage(`Error: ${errorData.error || "Failed to fetch token"}`);
        setShowToast(true);
      }
    } catch (error) {
      console.error("Failed to fetch token:", error);
      setToastMessage("Failed to fetch token.");
      setShowToast(true);
    }
  }, [fetch, showToast]);

  useEffect(() => {
    getUserToken();
  }, [getUserToken]);

  // Manual sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/settings/manual-sync/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to start orders sync: ${errorText}`);
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["orders"]);
      setToastMessage("Orders sync completed successfully!");
      setShowToast(true);
    },
    onError: (error) => {
      console.error("Orders sync error:", error);
      setToastMessage(`Orders sync failed: ${error.message}`);
      setShowToast(true);
    },
  });

  const handleVendorFilterChange = useCallback((value) => {
    setVendorFilter(value);
    setCurrentPage(1);
  }, []);

  const handleStatusFilterChange = useCallback((value) => {
    setStatusFilter(value);
    setCurrentPage(1);
  }, []);

  const handleSearchChange = useCallback((value) => {
    setSearchValue(value);
    setCurrentPage(1);
  }, []);

  const handleFiltersRemove = useCallback(() => {
    setVendorFilter("");
    setStatusFilter("active");
    setSearchValue("");
    setCurrentPage(1);
  }, []);

  const handleViewOrder = useCallback((order) => {
    setSelectedOrder(order);
    setIsOrderModalOpen(true);
  }, []);

  // Enhanced table data preparation with cancelled status
  const tableData =
    ordersData?.orders?.map((order) => [
      <InlineStack gap="200">
        <Text variant="bodyMd" fontWeight="semibold">
          {order.name}
        </Text>
        {order.isCancelled && <Badge tone="critical">Cancelled</Badge>}
      </InlineStack>,
      order.notification ? (
        <Badge tone="success">Notified</Badge>
      ) : order.isCancelled ? (
        <Badge tone="neutral">N/A</Badge>
      ) : (
        <Badge tone="warning">Pending</Badge>
      ),
      new Date(
        order.shopify_created_at || order.createdAt
      ).toLocaleDateString(),
      order.cancelledAt ? (
        <Text tone="subdued">
          {new Date(order.cancelledAt).toLocaleDateString()}
        </Text>
      ) : (
        <Text>—</Text>
      ),
      <Button
        size="slim"
        icon={ViewIcon}
        onClick={() => handleViewOrder(order)}
      >
        View
      </Button>,
    ]) || [];

  const tableHeaders = [
    "Order Number",
    "Notification",
    "Created",
    "Cancelled",
    "Actions",
  ];

  // Filter options
  const vendorOptions = [
    { label: "All vendors", value: "" },
    ...(vendorsData?.vendors?.map((vendor) => ({
      label: vendor.name,
      value: vendor.shopifyVendorName || vendor.name,
    })) || []),
  ];

  const statusOptions = [
    { label: "Active orders", value: "active" },
    { label: "Cancelled orders", value: "cancelled" },
    { label: "All orders", value: "all" },
  ];

  const appliedFilters = [];
  if (vendorFilter)
    appliedFilters.push({
      key: "vendor",
      label: `Vendor: ${vendorFilter}`,
      onRemove: () => setVendorFilter(""),
    });
  if (statusFilter !== "active")
    appliedFilters.push({
      key: "status",
      label: `Status: ${statusFilter === "cancelled" ? "Cancelled" : "All"}`,
      onRemove: () => setStatusFilter("active"),
    });
  if (searchValue)
    appliedFilters.push({
      key: "search",
      label: `Search: ${searchValue}`,
      onRemove: () => setSearchValue(""),
    });

  const filters = (
    <Filters
      queryValue={searchValue}
      filters={[
        {
          key: "vendor",
          label: "Vendor",
          filter: (
            <Select
              label="Vendor"
              labelHidden
              options={vendorOptions}
              value={vendorFilter}
              onChange={handleVendorFilterChange}
            />
          ),
        },
        {
          key: "status",
          label: "Order Status",
          filter: (
            <Select
              label="Order Status"
              labelHidden
              options={statusOptions}
              value={statusFilter}
              onChange={handleStatusFilterChange}
            />
          ),
        },
      ]}
      appliedFilters={appliedFilters}
      onQueryChange={handleSearchChange}
      onQueryClear={() => setSearchValue("")}
      onClearAll={handleFiltersRemove}
      queryPlaceholder="Search orders..."
    />
  );

  // Stats banner
  const orderStats = ordersData && (
    <div style={{ marginBottom: "1rem" }}>
      <InlineStack gap="400">
        <Badge tone="info">
          Total: {ordersData.pagination?.total || 0} orders
        </Badge>
        {statusFilter === "all" && ordersData.orders && (
          <>
            <Badge tone="success">
              Active: {ordersData.orders.filter((o) => !o.isCancelled).length}
            </Badge>
            <Badge tone="critical">
              Cancelled: {ordersData.orders.filter((o) => o.isCancelled).length}
            </Badge>
          </>
        )}
      </InlineStack>
    </div>
  );

  // Debug info for investigating single order issue
  const debugInfo = ordersData && (
    <Banner
      title="Debug Information"
      tone="info"
      onDismiss={() => setShowDebugInfo(false)}
    >
      <BlockStack gap="200">
        <Text>
          <strong>Total Orders in Database:</strong>{" "}
          {ordersData.pagination?.total || 0}
        </Text>
        <Text>
          <strong>Orders Returned:</strong> {ordersData.orders?.length || 0}
        </Text>
        <Text>
          <strong>Current Page:</strong> {currentPage}
        </Text>
        <Text>
          <strong>Items Per Page:</strong> {itemsPerPage}
        </Text>
        <Text>
          <strong>Applied Filters:</strong>{" "}
          {appliedFilters.length > 0
            ? appliedFilters.map((f) => f.label).join(", ")
            : "None"}
        </Text>
        <Text>
          <strong>Search Value:</strong> {searchValue || "None"}
        </Text>
        <Text>
          <strong>Status Filter:</strong> {statusFilter}
        </Text>
      </BlockStack>
    </Banner>
  );

  const toastMarkup = showToast ? (
    <Toast content={toastMessage} onDismiss={() => setShowToast(false)} />
  ) : null;

  if (error) {
    return (
      <Frame>
        <Page fullWidth>
          <TitleBar title="Orders" />
          <Layout>
            <Layout.Section>
              <Card>
                <EmptyState
                  heading="Error loading orders"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    There was an error loading the orders data: {error.message}
                  </p>
                  <InlineStack gap="300">
                    <Button onClick={() => refetch()}>Try again</Button>
                    <Button onClick={() => setShowDebugInfo(true)}>
                      Show Debug Info
                    </Button>
                  </InlineStack>
                </EmptyState>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
      </Frame>
    );
  }

  return (
    <Frame>
      <Page fullWidth>
        <TitleBar title="Orders">
          <button
            variant="primary"
            loading={syncMutation.isLoading}
            onClick={() => syncMutation.mutate()}
          >
            Sync Orders
          </button>
        </TitleBar>
        <Layout>
          <Layout.Section>
            {showDebugInfo && debugInfo}

            <Card>
              <div style={{ marginBottom: "1rem" }}>{filters}</div>
              {orderStats}

              {isLoading ? (
                <div style={{ textAlign: "center", padding: "2rem" }}>
                  <Spinner size="large" />
                  <Text variant="bodyMd" tone="subdued">
                    Loading orders...
                  </Text>
                </div>
              ) : tableData.length === 0 ? (
                <EmptyState
                  heading={
                    statusFilter === "cancelled"
                      ? "No cancelled orders found"
                      : "No orders found"
                  }
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p style={{ marginBottom: "20px" }}>
                    {searchValue || vendorFilter || statusFilter !== "active"
                      ? "Try adjusting your search or filter criteria."
                      : "No orders have been synced yet. Orders will appear automatically when they are created in your store."}
                  </p>
                  <InlineStack align="center" gap="300">
                    {(searchValue ||
                      vendorFilter ||
                      statusFilter !== "active") && (
                      <Button onClick={handleFiltersRemove}>
                        Clear Filters
                      </Button>
                    )}
                    <Button
                      primary
                      loading={syncMutation.isLoading}
                      onClick={() => syncMutation.mutate()}
                    >
                      Sync Data
                    </Button>
                  </InlineStack>
                </EmptyState>
              ) : (
                <>
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "text",
                      "text",
                      "text",
                      "text",
                    ]}
                    headings={tableHeaders}
                    rows={tableData}
                    hoverable
                  />

                  {ordersData?.pagination && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: "1rem",
                        padding: "1rem 0",
                      }}
                    >
                      <Text variant="bodySm" tone="subdued">
                        Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
                        {Math.min(
                          currentPage * itemsPerPage,
                          ordersData.pagination.total
                        )}{" "}
                        of {ordersData.pagination.total} orders
                      </Text>

                      <Pagination
                        hasPrevious={currentPage > 1}
                        onPrevious={() => setCurrentPage(currentPage - 1)}
                        hasNext={currentPage < ordersData.pagination.totalPages}
                        onNext={() => setCurrentPage(currentPage + 1)}
                      />
                    </div>
                  )}
                </>
              )}
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Orders chats box</Text>
                <div>
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (token) {
                        window.open(
                          `https://vendor-alert-webapp.vercel.app/verify-user?token=${token}`,
                          "_blank"
                        );
                      } else {
                        alert("Missing token");
                      }
                    }}
                  >
                    Go to chats
                  </Button>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Order Details Modal */}
        <Modal
          large
          open={isOrderModalOpen}
          onClose={() => {
            setIsOrderModalOpen(false);
            setSelectedOrder(null);
          }}
          title={`Order ${selectedOrder?.name}`}
          secondaryActions={[
            {
              content: "Close",
              onAction: () => {
                setIsOrderModalOpen(false);
                setSelectedOrder(null);
              },
            },
          ]}
        >
          <Modal.Section>
            {selectedOrder ? (
              <Layout>
                <Layout.Section oneHalf>
                  <Card title="Order Information">
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Order ID:
                        </Text>
                        <Text>{selectedOrder.name}</Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Status:
                        </Text>
                        {selectedOrder.isCancelled ? (
                          <Badge tone="critical">Cancelled</Badge>
                        ) : (
                          <Badge tone="success">Active</Badge>
                        )}
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Notification:
                        </Text>
                        {selectedOrder.notification ? (
                          <Badge tone="success">Notified</Badge>
                        ) : selectedOrder.isCancelled ? (
                          <Badge tone="neutral">N/A</Badge>
                        ) : (
                          <Badge tone="warning">Pending</Badge>
                        )}
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Created:
                        </Text>
                        <Text>
                          {new Date(
                            selectedOrder.shopify_created_at ||
                              selectedOrder.createdAt
                          ).toLocaleString()}
                        </Text>
                      </InlineStack>
                      {selectedOrder.cancelledAt && (
                        <InlineStack align="space-between">
                          <Text variant="bodyMd" fontWeight="medium">
                            Cancelled:
                          </Text>
                          <Text tone="subdued">
                            {new Date(
                              selectedOrder.cancelledAt
                            ).toLocaleString()}
                          </Text>
                        </InlineStack>
                      )}
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section oneHalf>
                  <Card title="Line Items">
                    {selectedOrder.lineItems &&
                    selectedOrder.lineItems.length > 0 ? (
                      <List type="bullet">
                        {selectedOrder.lineItems.map((item, index) => (
                          <List.Item key={index}>
                            <BlockStack gap="200">
                              <Text variant="bodyMd" fontWeight="medium">
                                {item.title}
                              </Text>
                              <InlineStack gap="400">
                                <Text variant="bodySm" tone="subdued">
                                  Vendor: {item.vendor || "—"}
                                </Text>
                                <Text variant="bodySm" tone="subdued">
                                  Qty: {item.quantity}
                                </Text>
                                <Text variant="bodySm" tone="subdued">
                                  Notification:{"  "}
                                  {item.notification ? (
                                    <Badge tone="success">Notified</Badge>
                                  ) : selectedOrder.isCancelled ? (
                                    <Badge tone="neutral">N/A</Badge>
                                  ) : (
                                    <Badge tone="warning">Pending</Badge>
                                  )}
                                </Text>
                              </InlineStack>
                            </BlockStack>
                          </List.Item>
                        ))}
                      </List>
                    ) : (
                      <Text tone="subdued">No line items found</Text>
                    )}
                  </Card>
                </Layout.Section>
              </Layout>
            ) : (
              <EmptyState
                heading="No order selected"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Select an order from the table to view its details.</p>
              </EmptyState>
            )}
          </Modal.Section>
        </Modal>
        {toastMarkup}
      </Page>
    </Frame>
  );
}
