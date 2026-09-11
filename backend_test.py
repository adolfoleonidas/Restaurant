#!/usr/bin/env python3
"""
Backend API Testing for Restaurant Management System
Tests all endpoints with the 4 demo user roles
"""
import os
import requests
import sys
from datetime import datetime

BASE_URL = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")

# Demo credentials from seed.py
CREDENTIALS = {
    "admin": {"email": "admin@resto.com", "password": "admin123"},
    "cajero": {"email": "cajero@resto.com", "password": "cajero123"},
    "mozo": {"email": "mozo@resto.com", "password": "mozo123"},
    "cocina": {"email": "cocina@resto.com", "password": "cocina123"},
}


class RestaurantAPITester:
    def __init__(self):
        self.tokens = {}
        self.users = {}
        self.tests_run = 0
        self.tests_passed = 0
        self.test_data = {}  # Store created entities for cleanup/reference

    def log(self, emoji, message):
        print(f"{emoji} {message}")

    def test(self, name, method, endpoint, expected_status, data=None, token=None, role=None, accept_alt_status=None):
        """Run a single API test"""
        url = f"{BASE_URL}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        elif role and role in self.tokens:
            headers['Authorization'] = f'Bearer {self.tokens[role]}'

        self.tests_run += 1
        self.log("🔍", f"Testing {name}...")

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PATCH':
                response = requests.patch(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)
            else:
                self.log("❌", f"Unknown method {method}")
                return False, {}

            # Accept alternative status codes (e.g., 200 instead of 201)
            success = response.status_code == expected_status or (accept_alt_status and response.status_code == accept_alt_status)
            if success:
                self.tests_passed += 1
                if response.status_code != expected_status:
                    self.log("✅", f"Passed - Status: {response.status_code} (expected {expected_status}, minor issue)")
                else:
                    self.log("✅", f"Passed - Status: {response.status_code}")
            else:
                self.log("❌", f"Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    self.log("📄", f"Response: {response.json()}")
                except:
                    self.log("📄", f"Response: {response.text[:200]}")

            try:
                return success, response.json() if response.text else {}
            except:
                return success, {}

        except Exception as e:
            self.log("❌", f"Failed - Error: {str(e)}")
            return False, {}

    def test_health(self):
        """Test health endpoint"""
        self.log("🏥", "=== Testing Health Endpoint ===")
        success, _ = self.test("Health Check", "GET", "health", 200)
        return success

    def test_auth_all_roles(self):
        """Test login for all 4 roles"""
        self.log("🔐", "=== Testing Authentication for All Roles ===")
        all_success = True

        for role, creds in CREDENTIALS.items():
            success, response = self.test(
                f"Login as {role}",
                "POST",
                "auth/login",
                200,
                data=creds
            )
            if success:
                if "access_token" in response and "user" in response:
                    self.tokens[role] = response["access_token"]
                    self.users[role] = response["user"]
                    self.log("✅", f"Token stored for {role}: {response['user'].get('full_name')}")
                else:
                    self.log("❌", f"Missing access_token or user in response for {role}")
                    all_success = False
            else:
                all_success = False

        return all_success

    def test_auth_me(self):
        """Test /auth/me for each role"""
        self.log("👤", "=== Testing /auth/me for All Roles ===")
        all_success = True

        for role in CREDENTIALS.keys():
            if role not in self.tokens:
                self.log("⚠️", f"Skipping {role} - no token")
                continue
            success, response = self.test(
                f"Get current user as {role}",
                "GET",
                "auth/me",
                200,
                role=role
            )
            if success and response.get("role") == role:
                self.log("✅", f"Verified role: {role}")
            else:
                all_success = False

        return all_success

    def test_tables(self):
        """Test tables endpoints"""
        self.log("🪑", "=== Testing Tables Endpoints ===")
        
        # List tables (should have 12 from seed)
        success, response = self.test(
            "List tables",
            "GET",
            "tables",
            200,
            role="admin"
        )
        if success and isinstance(response, list):
            self.log("✅", f"Found {len(response)} tables")
            if len(response) > 0:
                self.test_data["table_id"] = response[0]["id"]
        else:
            return False

        # Create a new table
        success, response = self.test(
            "Create table",
            "POST",
            "tables",
            201,
            data={"number": 99, "name": "Test Table", "capacity": 4, "area": "Test Area"},
            role="admin",
            accept_alt_status=200
        )
        if success:
            self.test_data["created_table_id"] = response.get("id")

        return True

    def test_categories(self):
        """Test categories endpoints"""
        self.log("📂", "=== Testing Categories Endpoints ===")
        
        # List categories (should have 5 from seed)
        success, response = self.test(
            "List categories",
            "GET",
            "categories",
            200,
            role="admin"
        )
        if success and isinstance(response, list):
            self.log("✅", f"Found {len(response)} categories")
            if len(response) > 0:
                self.test_data["category_id"] = response[0]["id"]
        else:
            return False

        # Create a new category
        success, response = self.test(
            "Create category",
            "POST",
            "categories",
            201,
            data={"name": "Test Category", "description": "For testing", "sort_order": 99},
            role="admin",
            accept_alt_status=200
        )
        if success:
            self.test_data["created_category_id"] = response.get("id")

        return True

    def test_products(self):
        """Test products endpoints"""
        self.log("🍽️", "=== Testing Products Endpoints ===")
        
        # List products (should have 14 from seed)
        success, response = self.test(
            "List products",
            "GET",
            "products",
            200,
            role="admin"
        )
        if success and isinstance(response, list):
            self.log("✅", f"Found {len(response)} products")
            if len(response) >= 2:
                self.test_data["product_id_1"] = response[0]["id"]
                self.test_data["product_id_2"] = response[1]["id"]
        else:
            return False

        # Create a new product
        if "category_id" in self.test_data:
            success, response = self.test(
                "Create product",
                "POST",
                "products",
                201,
                data={
                    "category_id": self.test_data["category_id"],
                    "name": "Test Product",
                    "description": "For testing",
                    "price": 25.50,
                    "is_available": True,
                    "preparation_time": 10
                },
                role="admin",
                accept_alt_status=200
            )
            if success:
                self.test_data["created_product_id"] = response.get("id")

        return True

    def test_order_flow(self):
        """Test complete order flow: create → send-to-kitchen → prepare → ready → deliver → pay"""
        self.log("📝", "=== Testing Order Flow ===")
        
        if "table_id" not in self.test_data or "product_id_1" not in self.test_data:
            self.log("⚠️", "Skipping order flow - missing table or products")
            return False

        # 1. Create order as mozo
        success, response = self.test(
            "Create order (mozo)",
            "POST",
            "orders",
            201,
            data={
                "table_id": self.test_data["table_id"],
                "order_type": "mesa",
                "items": [
                    {"product_id": self.test_data["product_id_1"], "quantity": 2, "notes": "Sin cebolla"},
                    {"product_id": self.test_data["product_id_2"], "quantity": 1, "notes": "Extra picante"}
                ],
                "notes": "Test order"
            },
            role="mozo",
            accept_alt_status=200
        )
        if not success:
            return False
        
        order_id = response.get("id")
        self.test_data["order_id"] = order_id
        self.log("✅", f"Order created: {order_id}")

        # 2. Send to kitchen
        success, _ = self.test(
            "Send to kitchen",
            "POST",
            f"orders/{order_id}/send-to-kitchen",
            200,
            role="mozo"
        )
        if not success:
            return False

        # 3. Change status to en_preparacion (cocina role)
        success, _ = self.test(
            "Change status to en_preparacion (cocina)",
            "POST",
            f"orders/{order_id}/status",
            200,
            data={"status": "en_preparacion"},
            role="cocina"
        )
        if not success:
            return False

        # 4. Change status to listo (cocina role)
        success, _ = self.test(
            "Change status to listo (cocina)",
            "POST",
            f"orders/{order_id}/status",
            200,
            data={"status": "listo"},
            role="cocina"
        )
        if not success:
            return False

        # 5. Mark as entregado (mozo role)
        success, _ = self.test(
            "Mark as entregado (mozo)",
            "POST",
            f"orders/{order_id}/status",
            200,
            data={"status": "entregado"},
            role="mozo"
        )
        if not success:
            return False

        # 6. Request payment (pendiente_pago)
        success, _ = self.test(
            "Request payment (mozo)",
            "POST",
            f"orders/{order_id}/status",
            200,
            data={"status": "pendiente_pago"},
            role="mozo"
        )
        if not success:
            return False

        self.log("✅", "Order flow completed successfully")
        return True

    def test_kitchen_board(self):
        """Test kitchen board endpoint"""
        self.log("👨‍🍳", "=== Testing Kitchen Board ===")
        
        success, response = self.test(
            "Get kitchen orders",
            "GET",
            "orders/kitchen",
            200,
            role="cocina"
        )
        if success:
            self.log("✅", f"Kitchen board returned {len(response)} orders")
        return success

    def test_cash_register(self):
        """Test cash register flow: open → add movement → close"""
        self.log("💰", "=== Testing Cash Register ===")
        
        # Check current register
        success, response = self.test(
            "Get current register",
            "GET",
            "cash/current",
            200,
            role="cajero"
        )
        
        # If there's an open register, close it first
        if success and response:
            self.log("⚠️", "Found open register, closing it first")
            self.test(
                "Close existing register",
                "POST",
                "cash/close",
                200,
                data={"closing_amount": 1000.0, "notes": "Closing for test"},
                role="cajero"
            )

        # Open new register
        success, response = self.test(
            "Open cash register",
            "POST",
            "cash/open",
            201,
            data={"opening_amount": 500.0, "notes": "Test opening"},
            role="cajero",
            accept_alt_status=200
        )
        if not success:
            return False

        register_id = response.get("id")
        self.log("✅", f"Register opened: {register_id}")

        # Add income movement
        success, _ = self.test(
            "Add income movement",
            "POST",
            "cash/movements",
            201,
            data={"type": "ingreso", "amount": 50.0, "description": "Test income"},
            role="cajero",
            accept_alt_status=200
        )

        # Add expense movement
        success, _ = self.test(
            "Add expense movement",
            "POST",
            "cash/movements",
            201,
            data={"type": "egreso", "amount": 20.0, "description": "Test expense"},
            role="cajero",
            accept_alt_status=200
        )

        return True

    def test_payment(self):
        """Test payment creation"""
        self.log("💳", "=== Testing Payment ===")
        
        if "order_id" not in self.test_data:
            self.log("⚠️", "Skipping payment - no order created")
            return False

        # Create payment with efectivo
        success, response = self.test(
            "Create payment (efectivo)",
            "POST",
            "payments",
            201,
            data={
                "order_id": self.test_data["order_id"],
                "method": "efectivo",
                "amount": 100.0,
                "received_amount": 150.0,
                "discount": 0.0,
                "tip": 5.0
            },
            role="cajero",
            accept_alt_status=200
        )
        if success:
            change = response.get("change_amount", 0)
            self.log("✅", f"Payment created, change: S/ {change}")
        return success

    def test_reports(self):
        """Test reports endpoint"""
        self.log("📊", "=== Testing Reports ===")
        
        # Test dashboard endpoint
        success, response = self.test(
            "Get dashboard",
            "GET",
            "reports/dashboard",
            200,
            role="admin"
        )
        if success:
            self.log("✅", "Dashboard endpoint working")
        
        # Test sales report
        success, response = self.test(
            "Get sales report",
            "GET",
            "reports/sales?period=day",
            200,
            role="admin"
        )
        if success:
            self.log("✅", "Sales report endpoint working")
        
        return success

    def test_users_crud(self):
        """Test users CRUD (admin only)"""
        self.log("👥", "=== Testing Users CRUD ===")
        
        # List users
        success, response = self.test(
            "List users",
            "GET",
            "users",
            200,
            role="admin"
        )
        if not success:
            return False

        # Create new user
        success, response = self.test(
            "Create user",
            "POST",
            "users",
            201,
            data={
                "email": f"test_{datetime.now().strftime('%H%M%S')}@resto.com",
                "password": "test123",
                "full_name": "Test User",
                "role": "mozo",
                "phone": "+51 999 999 999"
            },
            role="admin",
            accept_alt_status=200
        )
        if success:
            self.test_data["created_user_id"] = response.get("id")

        return True

    def test_role_based_access(self):
        """Test role-based access control"""
        self.log("🔒", "=== Testing Role-Based Access Control ===")
        
        # Mozo should NOT be able to access users endpoint
        success, _ = self.test(
            "Mozo accessing users (should fail)",
            "GET",
            "users",
            403,
            role="mozo"
        )
        if not success:
            self.log("❌", "Expected 403 for mozo accessing users")
            return False

        # Cocina should NOT be able to create payments
        if "order_id" in self.test_data:
            success, _ = self.test(
                "Cocina creating payment (should fail)",
                "POST",
                "payments",
                403,
                data={
                    "order_id": self.test_data["order_id"],
                    "method": "efectivo",
                    "amount": 100.0
                },
                role="cocina"
            )
            if not success:
                self.log("❌", "Expected 403 for cocina creating payment")
                return False

        self.log("✅", "Role-based access control working")
        return True

    def run_all_tests(self):
        """Run all tests in sequence"""
        self.log("🚀", "=== Starting Backend API Tests ===\n")

        # Basic tests
        self.test_health()
        
        # Auth tests (critical - must pass)
        if not self.test_auth_all_roles():
            self.log("❌", "Auth tests failed - cannot continue")
            return False
        
        self.test_auth_me()

        # Data tests
        self.test_tables()
        self.test_categories()
        self.test_products()

        # Flow tests
        self.test_order_flow()
        self.test_kitchen_board()
        self.test_cash_register()
        self.test_payment()

        # Admin tests
        self.test_users_crud()
        self.test_reports()

        # Security tests
        self.test_role_based_access()

        # Summary
        self.log("📊", f"\n=== Test Summary ===")
        self.log("📊", f"Tests run: {self.tests_run}")
        self.log("📊", f"Tests passed: {self.tests_passed}")
        self.log("📊", f"Tests failed: {self.tests_run - self.tests_passed}")
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        self.log("📊", f"Success rate: {success_rate:.1f}%")

        return self.tests_passed == self.tests_run


def main():
    tester = RestaurantAPITester()
    success = tester.run_all_tests()
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
