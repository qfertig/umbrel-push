"""The error the HTTP layer turns into a JSON answer: a status, one plain sentence, and a short machine code."""
from __future__ import annotations


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str = ""):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code
