<?php declare(strict_types = 1);
/*
** Copyright (C) 2001-2024 Zabbix SIA
**
** This program is free software: you can redistribute it and/or modify it under the terms of
** the GNU Affero General Public License as published by the Free Software Foundation, version 3.
**
** This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
** without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
** See the GNU Affero General Public License for more details.
**
** You should have received a copy of the GNU Affero General Public License along with this program.
** If not, see <https://www.gnu.org/licenses/>.
**/

/**
 * Host navigator widget view.
 *
 * @var CView $this
 * @var array $data
 */

if (!isset($data['vars']) || !is_array($data['vars'])) {
    throw new InvalidArgumentException('Invalid data format');
}

$view = new CWidgetView($data);

foreach ($data['vars'] as $name => $value) {
    if ($value !== null) {
        $view->setVar($name, $value);
    }
}

$view->show();

