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
  const itemsPerPage = 25;

  // Fetch orders data
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

      const response = await fetch(`/api/orders?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch orders");
      }
      return await response.json();
    },
    refetchOnWindowFocus: false,
    keepPreviousData: true,
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
      paid: { status: "success", children: "Paid" },
      pending: { status: "warning", children: "Pending" },
      refunded: { status: "critical", children: "Refunded" },
      partially_refunded: { status: "warning", children: "Partially Refunded" },
      voided: { status: "critical", children: "Voided" },
    };
    return <Badge {...(statusMap[status] || { children: status })} />;
  };

  const getFulfillmentStatusBadge = (status) => {
    const statusMap = {
      fulfilled: { status: "success", children: "Fulfilled" },
      partial: { status: "warning", children: "Partial" },
      unfulfilled: { status: "attention", children: "Unfulfilled" },
      restocked: { status: "info", children: "Restocked" },
    };
    return (
      <Badge
        {...(statusMap[status] || { children: status || "Unfulfilled" })}
      />
    );
  };

  // Prepare table data
  const tableData =
    ordersData?.orders?.map((order) => [
      <Text variant="bodyMd" fontWeight="semibold">
        {order.shopifyOrderNumber || order.shopifyOrderId}
      </Text>,
      `${parseFloat(order.totalPrice || 0).toFixed(2)}`,
      getFinancialStatusBadge(order.financialStatus),
      getFulfillmentStatusBadge(order.fulfillmentStatus),
      order.notified ? (
        <Badge status="success">Notified</Badge>
      ) : (
        <Badge status="warning">Pending</Badge>
      ),
      new Date(order.shopifyCreatedAt).toLocaleDateString(),
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
  );

  if (error) {
    return (
      <Page narrowWidth>
        <TitleBar title="Orders" />
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Error loading orders"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>There was an error loading the orders data.</p>
                <Button onClick={() => refetch()}>Try again</Button>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Orders">
        <button variant="primary" onClick={() => refetch()}>
          Refresh
        </button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          <Card>
            <div style={{ marginBottom: "1rem" }}>{filters}</div>

            {isLoading ? (
              <div style={{ textAlign: "center", padding: "2rem" }}>
                <Spinner size="large" />
              </div>
            ) : tableData.length === 0 ? (
              <EmptyState
                heading="No orders found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Try adjusting your filter criteria.</p>
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
        {ordersData?.orders && (
          <Layout.Section secondary>
            <Card title="Order Summary">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                }}
              >
                <div>
                  <Text variant="headingMd">{ordersData.orders.length}</Text>
                  <Text variant="bodySm" tone="subdued">
                    Orders Shown
                  </Text>
                </div>
                <div>
                  <Text variant="headingMd">
                    $
                    {ordersData.orders
                      .reduce(
                        (sum, order) => sum + parseFloat(order.totalPrice || 0),
                        0
                      )
                      .toFixed(2)}
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Total Value
                  </Text>
                </div>
                <div>
                  <Text variant="headingMd">
                    {
                      ordersData.orders.filter(
                        (o) => o.financialStatus === "paid"
                      ).length
                    }
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Paid Orders
                  </Text>
                </div>
                <div>
                  <Text variant="headingMd">
                    {ordersData.orders.filter((o) => o.notified).length}
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Vendors Notified
                  </Text>
                </div>
              </div>
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
        title={`Order #${
          selectedOrder?.shopifyOrderNumber || selectedOrder?.shopifyOrderId
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
                  <BlockStack vertical spacing="loose">
                    <BlockStack distribution="equalSpacing">
                      <Text variant="bodyMd" fontWeight="medium">
                        Order ID:
                      </Text>
                      <Text>
                        #
                        {orderDetails.order.shopifyOrderNumber ||
                          orderDetails.order.shopifyOrderId}
                      </Text>
                    </BlockStack>
                    <BlockStack distribution="equalSpacing">
                      <Text variant="bodyMd" fontWeight="medium">
                        Total:
                      </Text>
                      <Text>
                        $
                        {parseFloat(orderDetails.order.totalPrice || 0).toFixed(
                          2
                        )}
                      </Text>
                    </BlockStack>
                    <BlockStack distribution="equalSpacing">
                      <Text variant="bodyMd" fontWeight="medium">
                        Payment:
                      </Text>
                      {getFinancialStatusBadge(
                        orderDetails.order.financialStatus
                      )}
                    </BlockStack>
                    <BlockStack distribution="equalSpacing">
                      <Text variant="bodyMd" fontWeight="medium">
                        Fulfillment:
                      </Text>
                      {getFulfillmentStatusBadge(
                        orderDetails.order.fulfillmentStatus
                      )}
                    </BlockStack>
                    <BlockStack distribution="equalSpacing">
                      <Text variant="bodyMd" fontWeight="medium">
                        Notification:
                      </Text>
                      {orderDetails.order.notified ? (
                        <Badge status="success">Vendors Notified</Badge>
                      ) : (
                        <Badge status="warning">Pending</Badge>
                      )}
                    </BlockStack>
                    <BlockStack distribution="equalSpacing">
                      <Text variant="bodyMd" fontWeight="medium">
                        Date:
                      </Text>
                      <Text>
                        {new Date(
                          orderDetails.order.shopifyCreatedAt
                        ).toLocaleString()}
                      </Text>
                    </BlockStack>
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
                          <BlockStack vertical spacing="tight">
                            <Text variant="bodyMd" fontWeight="medium">
                              {item.title}
                            </Text>
                            <BlockStack distribution="equalSpacing">
                              <Text variant="bodySm" tone="subdued">
                                Vendor: {item.vendor || "—"}
                              </Text>
                              <Text variant="bodySm" tone="subdued">
                                Qty: {item.quantity}
                              </Text>
                              <Text variant="bodySm" tone="subdued">
                                ${parseFloat(item.price || 0).toFixed(2)}
                              </Text>
                            </BlockStack>
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
  );
}
