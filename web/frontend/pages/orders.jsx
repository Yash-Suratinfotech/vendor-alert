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
  Frame,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { useQuery } from "react-query";
import { ViewIcon } from "@shopify/polaris-icons";

export default function OrdersPage() {
  const [financialStatusFilter, setFinancialStatusFilter] = useState("");
  const [fulfillmentStatusFilter, setFulfillmentStatusFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const itemsPerPage = 25;

  // Fetch orders data with enhanced debugging
  const {
    data: ordersData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      "orders",
      financialStatusFilter,
      fulfillmentStatusFilter,
      vendorFilter,
      currentPage,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage,
        limit: itemsPerPage,
        ...(financialStatusFilter && {
          financial_status: financialStatusFilter,
        }),
        ...(fulfillmentStatusFilter && {
          fulfillment_status: fulfillmentStatusFilter,
        }),
        ...(vendorFilter && { vendor: vendorFilter }),
      });

      console.log("🔍 Fetching orders with params:", params.toString());

      const response = await fetch(`/api/orders?${params}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Orders API error:", response.status, errorText);
        throw new Error(`Failed to fetch orders: ${response.status}`);
      }

      const data = await response.json();
      console.log("📊 Orders API response:", {
        ordersCount: data.orders?.length || 0,
        totalFromPagination: data.pagination?.total || 0,
        hasOrders: !!data.orders,
        sampleOrder: data.orders?.[0],
      });

      return data;
    },
    refetchOnWindowFocus: false,
    keepPreviousData: true,
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

  // Fetch order details
  const { data: orderDetails, isLoading: isLoadingDetails } = useQuery({
    queryKey: ["order-details", selectedOrder?.id],
    queryFn: async () => {
      if (!selectedOrder?.id) return null;
      const response = await fetch(`/api/orders/${selectedOrder.id}`);
      if (!response.ok) {
        throw new Error("Failed to fetch order details");
      }
      return await response.json();
    },
    enabled: !!selectedOrder?.id,
    refetchOnWindowFocus: false,
  });

  const handleFinancialStatusChange = useCallback((value) => {
    setFinancialStatusFilter(value);
    setCurrentPage(1);
  }, []);

  const handleFulfillmentStatusChange = useCallback((value) => {
    setFulfillmentStatusFilter(value);
    setCurrentPage(1);
  }, []);

  const handleVendorFilterChange = useCallback((value) => {
    setVendorFilter(value);
    setCurrentPage(1);
  }, []);

  const handleFiltersRemove = useCallback(() => {
    setFinancialStatusFilter("");
    setFulfillmentStatusFilter("");
    setVendorFilter("");
    setCurrentPage(1);
  }, []);

  const handleViewOrder = useCallback((order) => {
    setSelectedOrder(order);
    setIsOrderModalOpen(true);
  }, []);

  const getFinancialStatusBadge = (status) => {
    const statusMap = {
      paid: { progress: "complete", children: "Paid" },
      pending: { progress: "incomplete", tone: "warning", children: "Pending" },
      refunded: { tone: "critical", children: "Refunded" },
      partially_refunded: { tone: "warning", children: "Partially Refunded" },
      voided: { tone: "critical", children: "Voided" },
      authorized: { tone: "info", children: "Authorized" },
      partially_paid: { tone: "warning", children: "Partially Paid" },
    };
    return (
      <Badge {...(statusMap[status] || { children: status || "Unknown" })} />
    );
  };

  const getFulfillmentStatusBadge = (status) => {
    const statusMap = {
      fulfilled: { progress: "complete", children: "Fulfilled" },
      partial: { progress: "incomplete", tone: "warning", children: "Partial" },
      unfulfilled: {
        progress: "incomplete",
        tone: "attention",
        children: "Unfulfilled",
      },
      restocked: { tone: "info", children: "Restocked" },
      null: { tone: "attention", children: "Unfulfilled" },
      undefined: { tone: "attention", children: "Unfulfilled" },
    };
    return (
      <Badge
        {...(statusMap[status] ||
          statusMap[status === null ? "null" : "unfulfilled"])}
      />
    );
  };

  // Enhanced table data preparation
  const tableData =
    ordersData?.orders?.map((order) => [
      <Text variant="bodyMd" fontWeight="semibold">
        {order.shopify_order_number || `#${order.shopify_order_id}`}
      </Text>,
      `$${parseFloat(order.total_price || 0).toFixed(2)}`,
      getFinancialStatusBadge(order.financial_status),
      getFulfillmentStatusBadge(order.fulfillment_status),
      order.notified ? (
        <Badge tone="success">Notified</Badge>
      ) : (
        <Badge tone="warning">Pending</Badge>
      ),
      new Date(
        order.shopify_created_at || order.createdAt
      ).toLocaleDateString(),
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
    "Total",
    "Payment",
    "Fulfillment",
    "Notification",
    "Date",
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

  const financialStatusOptions = [
    { label: "All payment statuses", value: "" },
    { label: "Paid", value: "paid" },
    { label: "Pending", value: "pending" },
    { label: "Authorized", value: "authorized" },
    { label: "Partially Paid", value: "partially_paid" },
    { label: "Refunded", value: "refunded" },
    { label: "Partially Refunded", value: "partially_refunded" },
    { label: "Voided", value: "voided" },
  ];

  const fulfillmentStatusOptions = [
    { label: "All fulfillment statuses", value: "" },
    { label: "Fulfilled", value: "fulfilled" },
    { label: "Partial", value: "partial" },
    { label: "Unfulfilled", value: "unfulfilled" },
    { label: "Restocked", value: "restocked" },
  ];

  const appliedFilters = [];
  if (financialStatusFilter)
    appliedFilters.push({
      key: "financial_status",
      label: `Payment: ${financialStatusFilter}`,
      onRemove: () => setFinancialStatusFilter(""),
    });
  if (fulfillmentStatusFilter)
    appliedFilters.push({
      key: "fulfillment_status",
      label: `Fulfillment: ${fulfillmentStatusFilter}`,
      onRemove: () => setFulfillmentStatusFilter(""),
    });
  if (vendorFilter)
    appliedFilters.push({
      key: "vendor",
      label: `Vendor: ${vendorFilter}`,
      onRemove: () => setVendorFilter(""),
    });

  const filters = (
    <div className="filter-box">
      <Filters
        filters={[
          {
            key: "financial_status",
            label: "Payment Status",
            filter: (
              <Select
                label="Payment Status"
                labelHidden
                options={financialStatusOptions}
                value={financialStatusFilter}
                onChange={handleFinancialStatusChange}
              />
            ),
          },
          {
            key: "fulfillment_status",
            label: "Fulfillment Status",
            filter: (
              <Select
                label="Fulfillment Status"
                labelHidden
                options={fulfillmentStatusOptions}
                value={fulfillmentStatusFilter}
                onChange={handleFulfillmentStatusChange}
              />
            ),
          },
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
        ]}
        appliedFilters={appliedFilters}
        onClearAll={handleFiltersRemove}
      />
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
      </BlockStack>
    </Banner>
  );

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
          <button variant="primary" onClick={() => refetch()}>
            Refresh
          </button>
        </TitleBar>
        <Layout>
          <Layout.Section>
            {showDebugInfo && debugInfo}

            <Card>
              <div style={{ marginBottom: "1rem" }}>
                <InlineStack gap="300" align="space-between">
                  {filters}
                  <Button
                    plain
                    onClick={() => setShowDebugInfo(!showDebugInfo)}
                  >
                    {showDebugInfo ? "Hide" : "Show"} Debug Info
                  </Button>
                </InlineStack>
              </div>

              {isLoading ? (
                <div style={{ textAlign: "center", padding: "2rem" }}>
                  <Spinner size="large" />
                  <Text variant="bodyMd" tone="subdued">
                    Loading orders...
                  </Text>
                </div>
              ) : tableData.length === 0 ? (
                <EmptyState
                  heading="No orders found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    {appliedFilters.length > 0
                      ? "Try adjusting your filter criteria or check if orders exist in your store."
                      : "No orders have been synced yet. Orders will appear automatically when they are created in your store."}
                  </p>
                  <InlineStack gap="300">
                    {appliedFilters.length > 0 && (
                      <Button onClick={handleFiltersRemove}>
                        Clear Filters
                      </Button>
                    )}
                    <Button
                      primary
                      onClick={() => (window.location.href = "/debug")}
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
                      "numeric",
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

          {/* Order Stats Summary */}
          {ordersData?.orders && ordersData.orders.length > 0 && (
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd">Order Summary</Text>

                  <div>
                    <Text variant="headingLg" as="h3">
                      {
                        ordersData.orders.filter(
                          (o) => o.financial_status === "paid"
                        ).length
                      }
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Paid Orders
                    </Text>
                  </div>

                  <div>
                    <Text variant="headingLg" as="h3">
                      {ordersData.orders.filter((o) => o.notified).length}
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Vendors Notified
                    </Text>
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>

        {/* Order Details Modal */}
        <Modal
          large
          open={isOrderModalOpen}
          onClose={() => {
            setIsOrderModalOpen(false);
            setSelectedOrder(null);
          }}
          title={`Order ${
            selectedOrder?.shopify_order_number ||
            selectedOrder?.shopify_order_id
          }`}
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
            {isLoadingDetails ? (
              <div style={{ textAlign: "center", padding: "2rem" }}>
                <Spinner size="large" />
              </div>
            ) : orderDetails ? (
              <Layout>
                <Layout.Section oneHalf>
                  <Card title="Order Information">
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Order ID:
                        </Text>
                        <Text>
                          {orderDetails.order.shopify_order_number ||
                            orderDetails.order.shopify_order_id}
                        </Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Total:
                        </Text>
                        <Text>
                          $
                          {parseFloat(
                            orderDetails.order.total_price || 0
                          ).toFixed(2)}
                        </Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Payment:
                        </Text>
                        {getFinancialStatusBadge(
                          orderDetails.order.financial_status
                        )}
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Fulfillment:
                        </Text>
                        {getFulfillmentStatusBadge(
                          orderDetails.order.fulfillment_status
                        )}
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Notification:
                        </Text>
                        {orderDetails.order.notified ? (
                          <Badge tone="success">Vendors Notified</Badge>
                        ) : (
                          <Badge tone="warning">Pending</Badge>
                        )}
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Date:
                        </Text>
                        <Text>
                          {new Date(
                            orderDetails.order.shopify_created_at
                          ).toLocaleString()}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Layout.Section>

                <Layout.Section oneHalf>
                  <Card title="Line Items">
                    {orderDetails.lineItems &&
                    orderDetails.lineItems.length > 0 ? (
                      <List type="bullet">
                        {orderDetails.lineItems.map((item, index) => (
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
                                  ${parseFloat(item.price || 0).toFixed(2)}
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
                heading="Failed to load order details"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>There was an error loading the order details.</p>
              </EmptyState>
            )}
          </Modal.Section>
        </Modal>
      </Page>
    </Frame>
  );
}
