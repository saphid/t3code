"""Offline regression tests for Cloudflare policy edits."""

import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "grafana_share_users", Path(__file__).with_name("grafana-share-users.py")
)
users = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(users)


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.app = {"id": "synthetic-app"}
        self.team = {
            "id": "synthetic-team",
            "name": "Team",
            "decision": "allow",
            "precedence": 1,
            "include": [{"email": {"email": "owner@example.test"}}],
        }
        self.email = "departing@example.test"
        self.group = {"group": {"id": "synthetic-group"}}

    def remove(self, policy):
        with (
            patch.object(users, "cloudflare_policy", return_value=(self.app, self.team)),
            patch.object(users, "cloudflare_policies", return_value=[self.team, policy]),
            patch.object(users, "grafana_state", return_value=([], [])),
            patch.object(users, "cf_result") as request,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            users.remove(self.email, "synthetic-cf-token", "synthetic-grafana-token")
        return request

    def policy(self, include):
        return {
            "id": "synthetic-enrollment",
            "name": "Enrollment",
            "decision": "allow",
            "precedence": 2,
            "include": include,
            "exclude": [{"email": {"email": "blocked@example.test"}}],
            "require": [{"login_method": {"id": "synthetic-idp"}}],
        }

    def test_removing_email_preserves_group_access_and_policy_constraints(self):
        policy = self.policy([{"email": {"email": self.email}}, self.group])
        request = self.remove(policy)
        request.assert_called_once()
        method, path, _, body = request.call_args.args
        self.assertEqual(method, "PUT")
        self.assertTrue(path.endswith("/policies/synthetic-enrollment"))
        self.assertEqual(body["include"], [self.group])
        self.assertEqual(body["exclude"], policy["exclude"])
        self.assertEqual(body["require"], policy["require"])

    def test_removing_the_only_email_deletes_the_empty_policy(self):
        request = self.remove(self.policy([{"email": {"email": self.email}}]))
        request.assert_called_once()
        self.assertEqual(request.call_args.args[0], "DELETE")

    def test_updating_email_membership_preserves_other_selector_types(self):
        policy = self.policy([self.group, {"email": {"email": self.email}}])
        with patch.object(users, "cf_result") as request:
            users.update_policy(
                "synthetic-token", self.app, policy, {"retained@example.test"}
            )
        self.assertEqual(
            request.call_args.args[3]["include"],
            [self.group, {"email": {"email": "retained@example.test"}}],
        )


if __name__ == "__main__":
    unittest.main()
