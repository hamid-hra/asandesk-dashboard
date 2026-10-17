"""Mobile number and email of panel users.

Optional when the owner creates an account; the user must fill both on their next sign-in
(the panel shows a form until `needs_contact` is false). Both are checked for format and must
not belong to another user.
"""

import re

from django.core.exceptions import ValidationError
from django.core.validators import validate_email

# ارقام فارسی و عربی هم پذیرفته می‌شوند
DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
IR_MOBILE = re.compile(r"^09\d{9}$")
# شمارهٔ خارجی به شکل بین‌المللی: + و کد کشور (غیر از ۹۸) و ۸ تا ۱۴ رقم
INTL = re.compile(r"^\+(?!98)[1-9]\d{7,13}$")

PHONE_BAD = "شمارهٔ موبایل درست نیست؛ مثل ۰۹۱۲۳۴۵۶۷۸۹ وارد کنید."
EMAIL_BAD = "ایمیل درست نیست؛ مثل name@example.com وارد کنید."


def normalize_phone(raw) -> str:
    """«+98 912 345 6789»، «۰۹۱۲۳۴۵۶۷۸۹» و «9123456789» همه «09123456789» می‌شوند."""
    s = re.sub(r"[\s\-().]", "", str(raw or "").translate(DIGITS))
    if s.startswith("+98"):
        s = "0" + s[3:]
    elif s.startswith("0098"):
        s = "0" + s[4:]
    elif s.startswith("00"):
        s = "+" + s[2:]
    elif s.startswith("98") and len(s) == 12:
        s = "0" + s[2:]
    elif s.startswith("9") and len(s) == 10:
        s = "0" + s
    return s


def normalize_email(raw) -> str:
    return str(raw or "").strip().lower()


def clean(user, data: dict, *, required: bool) -> tuple[dict, dict]:
    """Validates `email` and `phone` from `data` for `user` (may be unsaved).

    Returns (values, errors). A field missing from `data` is left out of `values`; with `required`
    both must end up non-empty.
    """
    from .models import User

    values, errors = {}, {}
    if "email" in data:
        email = normalize_email(data.get("email"))
        if email:
            try:
                validate_email(email)
            except ValidationError:
                errors["email"] = [EMAIL_BAD]
            else:
                if len(email) > 254:
                    errors["email"] = [EMAIL_BAD]
                elif User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
                    errors["email"] = ["این ایمیل مال کاربر دیگری است."]
        values["email"] = email
    if "phone" in data:
        phone = normalize_phone(data.get("phone"))
        if phone:
            if not (IR_MOBILE.match(phone) or INTL.match(phone)):
                errors["phone"] = [PHONE_BAD]
            elif User.objects.filter(phone=phone).exclude(pk=user.pk).exists():
                errors["phone"] = ["این شماره مال کاربر دیگری است."]
        values["phone"] = phone
    if required:
        if not values.get("email", user.email) and "email" not in errors:
            errors["email"] = ["ایمیل را وارد کنید."]
        if not values.get("phone", user.phone) and "phone" not in errors:
            errors["phone"] = ["شمارهٔ موبایل را وارد کنید."]
    return values, errors
